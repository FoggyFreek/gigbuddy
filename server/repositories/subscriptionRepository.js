// Data-access helpers for subscriptions. Subscriptions are user-owned
// (platform-level), not tenant-scoped; tenant access derives from
// tenants.owner_user_id via the entitlement resolver.

// The one live (non-canceled) subscription for a user, with its plan's slug
// and entitlements joined in. The partial unique index guarantees at most one.
export async function fetchLiveSubscriptionForUser(executor, userId) {
  const { rows } = await executor.query(
    `SELECT s.*, p.slug AS plan_slug, p.entitlements AS plan_entitlements
     FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.status <> 'canceled'`,
    [userId],
  )
  return rows[0] ?? null
}

// The one live subscription for a user, locked FOR UPDATE — the saga entry
// point (subscribe/cancel/resume/change/ingest) serializes on this row so
// concurrent webhook + user actions can't interleave.
export async function fetchLiveSubscriptionForUpdate(executor, userId) {
  const { rows } = await executor.query(
    `SELECT s.*, p.slug AS plan_slug, p.entitlements AS plan_entitlements
     FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.status <> 'canceled'
     FOR UPDATE OF s`,
    [userId],
  )
  return rows[0] ?? null
}

export async function fetchSubscriptionById(executor, id) {
  const { rows } = await executor.query(
    `SELECT s.*, p.slug AS plan_slug, p.entitlements AS plan_entitlements
     FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

// Locked read by id — used by ingestion (webhook/reconcile) which resolves the
// subscription from a payment, not from the acting user.
export async function fetchSubscriptionByIdForUpdate(executor, id) {
  const { rows } = await executor.query(
    `SELECT s.*, p.slug AS plan_slug, p.entitlements AS plan_entitlements
     FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.id = $1
     FOR UPDATE OF s`,
    [id],
  )
  return rows[0] ?? null
}

// Columns a caller may set at insert time. Anything else is ignored — the DB
// defaults (status flags, timestamps, empty overrides) take over.
const INSERTABLE = [
  'user_id', 'plan_id', 'status', 'billing_interval', 'price_cents',
  'trial_ends_at', 'current_period_start', 'current_period_end',
  'is_complimentary', 'complimentary_expires_at',
  'mollie_customer_id', 'mollie_mandate_id', 'mollie_subscription_id', 'mollie_first_payment_id',
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

// Renewal period advance with per-covered-period dedup: a second distinct paid
// attempt for the SAME period start changes nothing (returns null), so renewal
// effects/notifications never re-fire. Clears past_due and reactivates.
export async function advanceSubscriptionPeriod(executor, id, periodStart, periodEnd) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
     SET current_period_start = $2, current_period_end = $3,
         status = 'active', past_due_since = NULL, updated_at = NOW()
     WHERE id = $1 AND current_period_start IS DISTINCT FROM $2
     RETURNING id`,
    [id, periodStart, periodEnd],
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

// Trial is once per user: any subscription (even canceled) that ever carried a
// trial_ends_at counts as a used trial.
export async function hasUsedTrial(executor, userId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM subscriptions WHERE user_id = $1 AND trial_ends_at IS NOT NULL LIMIT 1',
    [userId],
  )
  return rowCount > 0
}

// Immediate plan switch during a trial (free — no charge). Flags the remote
// schedule stale so the pending Mollie subscription is recreated at the new
// amount before the trial ends.
export async function switchPlanTrial(executor, id, { planId, interval, priceCents }) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
     SET plan_id = $2, billing_interval = $3, price_cents = $4,
         mollie_schedule_stale = TRUE, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, planId, interval, priceCents],
  )
  return rows[0] ?? null
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

// ---- saga / lifecycle mutations ----

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

// Guarded status flip (e.g. pending_mandate → trialing / pending_activation on
// mandate confirmation). Returns the row when it moved, null otherwise.
export async function setStatusGuarded(executor, id, newStatus, fromStatus) {
  const { rows } = await executor.query(
    `UPDATE subscriptions SET status = $2, updated_at = NOW()
     WHERE id = $1 AND status = $3 RETURNING *`,
    [id, newStatus, fromStatus],
  )
  return rows[0] ?? null
}

export async function setPendingChange(executor, id, { planId, kind, interval, priceCents }) {
  await executor.query(
    `UPDATE subscriptions
     SET pending_plan_id = $2, pending_change_kind = $3,
         pending_billing_interval = $4, pending_price_cents = $5, updated_at = NOW()
     WHERE id = $1`,
    [id, planId, kind, interval, priceCents],
  )
}

export async function setPendingPaymentId(executor, id, paymentId) {
  await executor.query(
    'UPDATE subscriptions SET pending_payment_id = $2, updated_at = NOW() WHERE id = $1',
    [id, paymentId],
  )
}

// Clears every pending-change / downgrade-bookkeeping column in one shot.
export async function clearPendingChange(executor, id) {
  await executor.query(
    `UPDATE subscriptions
     SET pending_plan_id = NULL, pending_change_kind = NULL, pending_billing_interval = NULL,
         pending_price_cents = NULL, pending_payment_id = NULL,
         pending_purge_manifest = NULL, pending_limits_snapshot = NULL,
         downgrade_confirmed_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id],
  )
}

// Plan-change activate-first stage 0: switch plan/interval/price + set the new
// period, clear all pending state, and flag the remote schedule stale (repaired
// asynchronously). One transaction; the customer has paid, so entitlements move
// now regardless of the remote repair.
export async function applyPlanChangeActivation(executor, id, { planId, interval, priceCents, periodStart, periodEnd }) {
  const { rows } = await executor.query(
    `UPDATE subscriptions
     SET plan_id = $2, billing_interval = $3, price_cents = $4,
         current_period_start = $5, current_period_end = $6,
         status = 'active', past_due_since = NULL,
         pending_plan_id = NULL, pending_change_kind = NULL, pending_billing_interval = NULL,
         pending_price_cents = NULL, pending_payment_id = NULL,
         pending_purge_manifest = NULL, pending_limits_snapshot = NULL, downgrade_confirmed_at = NULL,
         mollie_schedule_stale = TRUE, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, planId, interval, priceCents, periodStart, periodEnd],
  )
  return rows[0] ?? null
}

// Cancel-at-period-end (resolver locks at period end on its own; scheduler
// flips durable status later). Does NOT set pending_plan_id, honoring the
// cancel_xor_pending CHECK.
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
     SET cancel_at_period_end = FALSE, cancel_reason = NULL,
         pending_purge_manifest = NULL, pending_limits_snapshot = NULL, updated_at = NOW()
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

// Admin listing: all live subscriptions with owner + plan, newest first.
// `repairOnly` narrows to those needing operator attention (stale schedule or
// flagged repair) for the SubscriptionsPage alert surface.
export async function listSubscriptionsForAdmin(executor, { repairOnly = false } = {}) {
  const { rows } = await executor.query(
    `SELECT s.*, p.slug AS plan_slug, u.name AS user_name, u.email AS user_email
     FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     JOIN users u ON u.id = s.user_id
     WHERE s.status <> 'canceled'
       AND ($1 = FALSE OR s.mollie_schedule_stale = TRUE OR s.billing_repair_needed = TRUE)
     ORDER BY s.created_at DESC`,
    [repairOnly],
  )
  return rows
}

// ---- scheduler candidate queries ----

// Stale pending_mandate: mandate never confirmed within the grace window.
export async function listStalePendingMandate(executor, olderThanMs) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE status = 'pending_mandate'
       AND created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
    [olderThanMs],
  )
  return rows
}

// Stale pending_activation: mandate confirmed but the first real charge never
// settled within the grace window (re-subscribe / trial-used path).
export async function listStalePendingActivation(executor, olderThanMs) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE status = 'pending_activation'
       AND created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
    [olderThanMs],
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

// Subscriptions whose remote schedule still needs repair (mandate confirmed but
// Mollie subscription not yet created, or a plan-change repair unfinished).
export async function listScheduleStale(executor) {
  const { rows } = await executor.query(
    `SELECT s.*, p.slug AS plan_slug FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.mollie_schedule_stale = TRUE AND s.status <> 'canceled'
       AND s.is_complimentary = FALSE`,
  )
  return rows
}

// trialing subscriptions whose trial has ended (poll → activate/past_due).
export async function listTrialEnded(executor) {
  const { rows } = await executor.query(
    `SELECT * FROM subscriptions
     WHERE status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()`,
  )
  return rows
}

// trialing subscriptions inside the T-2d reminder window, not yet reminded.
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
