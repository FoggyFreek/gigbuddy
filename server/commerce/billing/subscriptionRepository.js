// Data-access helpers for subscriptions. A subscription is user-owned
// (platform-level), not tenant-scoped; tenant access derives from
// tenants.owner_user_id via the entitlement resolver.
//
// The subscription row owns the CYCLE: status, interval, period, trial, the
// price snapshots and the provider linkage. Which products it contains lives in
// subscription_modules (subscriptionModuleRepository.js) — nothing here joins a
// plan any more.

// The user's one live (non-canceled) subscription.
export async function fetchLiveSubscriptionForUser(executor, userId) {
  const { rows } = await executor.query(
    "SELECT * FROM subscriptions WHERE user_id = $1 AND status <> 'canceled'",
    [userId],
  )
  return rows[0] ?? null
}

// The user's live subscription, locked FOR UPDATE — every saga entry point
// (trial/checkout/module change/cancel/ingest) serializes on this row so
// concurrent webhook and user actions cannot interleave. One row per user now,
// so this is also the lock that protects the whole module set.
export async function fetchLiveSubscriptionForUpdate(executor, userId) {
  const { rows } = await executor.query(
    "SELECT * FROM subscriptions WHERE user_id = $1 AND status <> 'canceled' FOR UPDATE",
    [userId],
  )
  return rows[0] ?? null
}

export async function fetchSubscriptionById(executor, id) {
  const { rows } = await executor.query('SELECT * FROM subscriptions WHERE id = $1', [id])
  return rows[0] ?? null
}

// Locked read by id — used by ingestion (webhook/reconcile), which resolves the
// subscription from a payment rather than from the acting user.
export async function fetchSubscriptionByIdForUpdate(executor, id) {
  const { rows } = await executor.query(
    'SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE',
    [id],
  )
  return rows[0] ?? null
}

// Columns a caller may set at insert time. Anything else is ignored — the DB
// defaults (status flags, timestamps) take over.
const INSERTABLE = [
  'user_id', 'status', 'billing_interval',
  'trial_ends_at', 'current_period_start', 'current_period_end',
  'price_snapshot', 'total_cents', 'next_price_snapshot', 'next_total_cents',
  'is_complimentary', 'complimentary_expires_at',
  'mollie_mandate_id', 'mollie_subscription_id', 'mollie_first_payment_id',
]

export async function insertSubscription(executor, fields) {
  const cols = INSERTABLE.filter((c) => fields[c] !== undefined)
  const values = cols.map((c) => fields[c])
  const placeholders = cols.map((_, i) => `$${i + 1}`)
  const { rows } = await executor.query(
    `INSERT INTO subscriptions (${cols.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  )
  return rows[0]
}

export async function setMandateLinkage(executor, id, { mandateId = null, subscriptionId = null, firstPaymentId = null } = {}) {
  await executor.query(
    `UPDATE subscriptions
     SET mollie_mandate_id = COALESCE($2, mollie_mandate_id),
         mollie_subscription_id = COALESCE($3, mollie_subscription_id),
         mollie_first_payment_id = COALESCE($4, mollie_first_payment_id),
         updated_at = NOW()
     WHERE id = $1`,
    [id, mandateId, subscriptionId, firstPaymentId],
  )
}

// ---- price snapshots ----

// The configuration the CURRENT period was charged at.
export async function setPriceSnapshot(executor, id, { snapshot, totalCents }) {
  await executor.query(
    `UPDATE subscriptions SET price_snapshot = $2, total_cents = $3, updated_at = NOW()
      WHERE id = $1`,
    [id, snapshot, totalCents],
  )
}

// What the NEXT renewal will charge, and the durable mirror of the provider
// schedule's amount. Flags the schedule stale whenever the amount actually
// moves, which is what carries a lapsed promo through to the next charge.
export async function setNextPriceSnapshot(executor, id, { snapshot, totalCents }) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
        SET next_price_snapshot = $2, next_total_cents = $3,
            mollie_schedule_stale = CASE
              WHEN next_total_cents IS DISTINCT FROM $3 THEN TRUE ELSE mollie_schedule_stale END,
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, snapshot, totalCents],
  )
  return rows[0] ?? null
}

// The configuration a mid-cycle module change will install once its prorated
// charge is paid.
export async function setPendingPriceSnapshot(executor, id, { snapshot, totalCents }) {
  await executor.query(
    `UPDATE subscriptions
        SET pending_price_snapshot = $2, pending_total_cents = $3, updated_at = NOW()
      WHERE id = $1`,
    [id, snapshot, totalCents],
  )
}

export async function clearPendingChange(executor, id) {
  await executor.query(
    `UPDATE subscriptions
        SET pending_price_snapshot = NULL, pending_total_cents = NULL,
            pending_payment_id = NULL, updated_at = NOW()
      WHERE id = $1`,
    [id],
  )
}

export async function setPendingPaymentId(executor, id, paymentId) {
  await executor.query(
    'UPDATE subscriptions SET pending_payment_id = $2, updated_at = NOW() WHERE id = $1',
    [id, paymentId],
  )
}

// ---- lifecycle ----

// Conversion: the trial's (or a fresh signup's) first full combined charge has
// been paid. Opens the first paid period and stamps the withdrawal-window
// anchor. Guarded so a replayed webhook cannot re-open the period.
export async function applyConversion(executor, id, { periodStart, periodEnd, paymentId }) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
        SET status = 'active', converted_at = COALESCE(converted_at, $2),
            current_period_start = $2, current_period_end = $3,
            past_due_since = NULL,
            last_charge_at = $2, last_charge_payment_id = $4,
            price_snapshot = COALESCE(pending_price_snapshot, price_snapshot),
            total_cents = COALESCE(pending_total_cents, total_cents),
            pending_price_snapshot = NULL, pending_total_cents = NULL, pending_payment_id = NULL,
            mollie_schedule_stale = TRUE, updated_at = NOW()
      WHERE id = $1 AND status IN ('trialing','pending_activation')
      RETURNING *`,
    [id, periodStart, periodEnd, paymentId],
  )
  return rows[0] ?? null
}

// Renewal period advance with per-covered-period dedup: a second distinct paid
// attempt for the SAME period start changes nothing (returns null), so renewal
// effects and notifications never re-fire. Installs the next-period snapshot as
// the current one, clears past_due, and re-anchors the withdrawal window.
export async function advanceSubscriptionPeriod(executor, id, periodStart, periodEnd, { paymentId = null } = {}) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
        SET current_period_start = $2, current_period_end = $3,
            status = 'active', past_due_since = NULL,
            converted_at = COALESCE(converted_at, $2),
            price_snapshot = COALESCE(next_price_snapshot, price_snapshot),
            total_cents = COALESCE(next_total_cents, total_cents),
            last_charge_at = $2, last_charge_payment_id = $4,
            updated_at = NOW()
      WHERE id = $1 AND current_period_start IS DISTINCT FROM $2
      RETURNING *`,
    [id, periodStart, periodEnd, paymentId],
  )
  return rows[0] ?? null
}

// Mid-cycle module change activation. Installs the pending snapshot and
// DELIBERATELY leaves current_period_end alone: the customer paid only the
// prorated difference, so the renewal date they already have must not move.
export async function applyModuleChangeActivation(executor, id) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
        SET price_snapshot = COALESCE(pending_price_snapshot, price_snapshot),
            total_cents = COALESCE(pending_total_cents, total_cents),
            pending_price_snapshot = NULL, pending_total_cents = NULL, pending_payment_id = NULL,
            mollie_schedule_stale = TRUE, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id],
  )
  return rows[0] ?? null
}

export async function markSubscriptionPastDue(executor, id, since) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
     SET status = 'past_due', past_due_since = COALESCE(past_due_since, $2), updated_at = NOW()
     WHERE id = $1 AND status <> 'canceled'
     RETURNING id`,
    [id, since],
  )
  return rows[0] ?? null
}

// The trial is once per USER now — one customer, one trial, whichever module
// they sampled it with. Any subscription row that ever carried a trial_ends_at
// counts, canceled ones included.
export async function hasUsedTrial(executor, userId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM subscriptions WHERE user_id = $1 AND trial_ends_at IS NOT NULL LIMIT 1',
    [userId],
  )
  return rowCount > 0
}

export async function setBillingInterval(executor, id, interval) {
  await executor.query(
    'UPDATE subscriptions SET billing_interval = $2, updated_at = NOW() WHERE id = $1',
    [id, interval],
  )
}

// ---- users.mollie_customer_id (billing owner ↔ provider customer) ----

export async function fetchUserMollieCustomerId(executor, userId) {
  const { rows } = await executor.query(
    'SELECT mollie_customer_id FROM users WHERE id = $1',
    [userId],
  )
  return rows[0]?.mollie_customer_id ?? null
}

export async function setUserMollieCustomerId(executor, userId, customerId) {
  await executor.query(
    'UPDATE users SET mollie_customer_id = $2 WHERE id = $1',
    [userId, customerId],
  )
}

// ---- saga / status mutations ----

export async function setScheduleStale(executor, id, value) {
  await executor.query(
    'UPDATE subscriptions SET mollie_schedule_stale = $2, updated_at = NOW() WHERE id = $1',
    [id, value],
  )
}

export async function setBillingRepairNeeded(executor, id, value) {
  await executor.query(
    'UPDATE subscriptions SET billing_repair_needed = $2, updated_at = NOW() WHERE id = $1',
    [id, value],
  )
}

// Guarded status flip. Returns the row when it moved, null otherwise. Entering
// pending_activation stamps pending_activation_at so the stale-activation
// sweep ages from the flip, not from created_at.
//
// `canceled` is terminal: nothing flips a canceled subscription back, which is
// what keeps a post-cancellation refund (paid → refunded at the provider) from
// reviving the row as past_due.
export async function setStatusGuarded(executor, id, newStatus, fromStatus) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
     SET status = $2,
         pending_activation_at = CASE WHEN $2 = 'pending_activation' THEN NOW() ELSE pending_activation_at END,
         updated_at = NOW()
     WHERE id = $1 AND status = $3 AND status <> 'canceled' RETURNING *`,
    [id, newStatus, fromStatus],
  )
  return rows[0] ?? null
}

// Cancel-at-period-end (the resolver locks at period end on its own; the
// scheduler flips durable status later).
export async function setCancelAtPeriodEnd(executor, id, reason) {
  await executor.query(
    `UPDATE subscriptions
     SET cancel_at_period_end = TRUE, cancel_reason = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, reason],
  )
}

export async function clearCancelAtPeriodEnd(executor, id) {
  await executor.query(
    `UPDATE subscriptions
     SET cancel_at_period_end = FALSE, cancel_reason = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id],
  )
}

// Terminal cancel. reason ∈ cancel_reason CHECK.
export async function cancelSubscriptionNow(executor, id, reason) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
     SET status = 'canceled', canceled_at = NOW(), cancel_reason = $2,
         cancel_at_period_end = FALSE, updated_at = NOW()
     WHERE id = $1 AND status <> 'canceled' RETURNING *`,
    [id, reason],
  )
  return rows[0] ?? null
}

// Admin listing: all live subscriptions with their owner, newest first.
// `repairOnly` narrows to those needing operator attention (stale schedule or
// flagged repair) for the SubscriptionsPage alert surface. Modules come back as
// a JSON aggregate so the operator sees the whole product mix in one row.
export async function listSubscriptionsForAdmin(executor, { repairOnly = false } = {}) {
  const { rows } = await executor.query(
    `SELECT s.*, u.name AS user_name, u.email AS user_email,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'audience', m.audience, 'planSlug', p.slug,
                       'status', m.status, 'priceCents', m.price_cents)
                     ORDER BY m.audience)
                FROM subscription_modules m
                JOIN subscription_plans p ON p.id = m.plan_id
               WHERE m.subscription_id = s.id), '[]'::json) AS modules
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.status <> 'canceled'
       AND ($1 = FALSE OR s.mollie_schedule_stale = TRUE OR s.billing_repair_needed = TRUE)
     ORDER BY s.created_at DESC`,
    [repairOnly],
  )
  return rows
}

// ---- scheduler candidate queries ----

// Stale pending_activation: a subscription whose first real charge never
// settled within the grace window, with nothing in flight.
export async function listStalePendingActivation(executor, olderThanMs) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE status = 'pending_activation'
       AND COALESCE(pending_activation_at, created_at) < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
    [olderThanMs],
  )
  return rows
}

// A trial that ran out without a mandate or payment still settling. A verified
// mandate means a delayed provider schedule exists (or is being repaired), so
// it must survive long enough for the trial-end charge to settle or fail.
export async function listExpiredTrials(executor, graceMs) {
  const { rows } = await executor.query(
    `SELECT s.* FROM subscriptions s
     WHERE s.status = 'trialing' AND s.trial_ends_at IS NOT NULL
       AND s.trial_ends_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
       AND s.mollie_mandate_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM subscription_payments sp
          WHERE sp.subscription_id = s.id AND sp.status IN ('open', 'pending')
       )`,
    [graceMs],
  )
  return rows
}

// True when the subscription has any nonterminal (open/pending) payment right
// now — an in-flight charge (e.g. SEPA) that must not be treated as abandoned.
export async function subscriptionHasNonterminalPayment(executor, subscriptionId) {
  const { rowCount } = await executor.query(
    `SELECT 1 FROM subscription_payments
     WHERE subscription_id = $1 AND status IN ('open', 'pending') LIMIT 1`,
    [subscriptionId],
  )
  return rowCount > 0
}

// Subscriptions whose remote schedule still needs repair (converted but the
// provider subscription not yet created, or its amount now out of date).
export async function listScheduleStale(executor) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE mollie_schedule_stale = TRUE AND status <> 'canceled'
       AND is_complimentary = FALSE`,
  )
  return rows
}

// Live subscriptions whose next-period price may have moved — a time-limited
// discount starting or lapsing changes what the renewal must charge even
// though nothing about the subscription itself changed.
export async function listRepriceCandidates(executor) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE status IN ('active','trialing','past_due')
       AND is_complimentary = FALSE
       AND cancel_at_period_end = FALSE`,
  )
  return rows
}

// trialing subscriptions inside a reminder window, not yet reminded.
export async function listTrialReminderDue(executor, windowMs) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE status = 'trialing' AND trial_reminder_sent_at IS NULL
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at <= NOW() + ($1::bigint * INTERVAL '1 millisecond')
       AND trial_ends_at > NOW()`,
    [windowMs],
  )
  return rows
}

export async function markTrialReminderSent(executor, id) {
  await executor.query(
    'UPDATE subscriptions SET trial_reminder_sent_at = NOW(), updated_at = NOW() WHERE id = $1',
    [id],
  )
}

// Active subscriptions renewing inside `windowMs`. Deliberately a wide sweep:
// the notice is made idempotent by its notification dedupe key (which carries
// the period end), not by narrowing the window to one tick.
export async function listRenewalNoticeDue(executor, windowMs) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE status = 'active' AND cancel_at_period_end = FALSE
       AND is_complimentary = FALSE
       AND current_period_end IS NOT NULL
       AND current_period_end > NOW()
       AND current_period_end <= NOW() + ($1::bigint * INTERVAL '1 millisecond')`,
    [windowMs],
  )
  return rows
}

// cancel_at_period_end subscriptions whose period has passed → terminal cancel.
export async function listCancelAtPeriodEndDue(executor) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE cancel_at_period_end = TRUE AND status <> 'canceled'
       AND current_period_end IS NOT NULL AND current_period_end < NOW()`,
  )
  return rows
}

// past_due subscriptions beyond the retry grace → force-cancel both sides.
export async function listPastDueExpired(executor, graceMs) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE status = 'past_due' AND past_due_since IS NOT NULL
       AND past_due_since < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
    [graceMs],
  )
  return rows
}

// active complimentary subscriptions past their expiry → revoke.
export async function listExpiredComplimentary(executor) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE is_complimentary = TRUE AND status = 'active'
       AND complimentary_expires_at IS NOT NULL AND complimentary_expires_at < NOW()`,
  )
  return rows
}

// True when a recurring charge created after the current period started is
// still nonterminal at Mollie (open/pending) — the SEPA-in-flight case that
// extends the resolver's grace window.
export async function hasNonterminalRecurringPayment(executor, subscriptionId, periodStart) {
  const { rowCount } = await executor.query(
    `SELECT 1 FROM subscription_payments
     WHERE subscription_id = $1
       AND kind = 'recurring'
       AND status IN ('open', 'pending')
       AND mollie_created_at > $2
     LIMIT 1`,
    [subscriptionId, periodStart],
  )
  return rowCount > 0
}
