// Local mirror of provider payments tied to a subscription. The upsert here is
// the single ingestion point for BOTH the webhook and the reconciliation poll;
// its ON CONFLICT ... WHERE billing_payment_transition_allowed(...) makes every
// outcome idempotent and race-free (see migration 104).
//
// Pure SQL; every function takes an executor first.

// Insert-or-legally-transition a payment. Returns the affected row
// (with `inserted` = true for a fresh insert) or NULL when the transition is
// inert — an illegal/regressive/duplicate status that the predicate rejects, so
// DO UPDATE is skipped and no effect should fire. `kind`/`amount_cents` are only
// ever set on first insert; later updates touch status/paid_at only.
export async function upsertPaymentOutcome(executor, {
  subscriptionId, molliePaymentId, kind, amountCents, status, paidAt = null, mollieCreatedAt = null,
  priceSnapshot = null,
}) {
  const { rows } = await executor.query(
    `INSERT INTO subscription_payments
       (subscription_id, mollie_payment_id, kind, amount_cents, status, paid_at, mollie_created_at,
        price_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (mollie_payment_id) DO UPDATE
       SET status = EXCLUDED.status,
           paid_at = COALESCE(EXCLUDED.paid_at, subscription_payments.paid_at),
           updated_at = NOW()
       WHERE billing_payment_transition_allowed(subscription_payments.status, EXCLUDED.status)
     RETURNING id, subscription_id, kind, amount_cents, status, paid_at, mollie_created_at,
               price_snapshot, (xmax = 0) AS inserted`,
    [subscriptionId, molliePaymentId, kind, amountCents, status, paidAt, mollieCreatedAt, priceSnapshot],
  )
  return rows[0] ?? null
}

// The charge that opened the current period — the conversion or renewal that
// the withdrawal window is measured from, and the only payment a self-service
// immediate cancellation refunds.
export async function fetchPaymentById(executor, id) {
  const { rows } = await executor.query('SELECT * FROM subscription_payments WHERE id = $1', [id])
  return rows[0] ?? null
}

// Locked, so the "already refunded ≤ amount" check and the refund row insert
// cannot interleave with a second refund request.
export async function fetchPaymentByMollieIdForUpdate(executor, molliePaymentId) {
  const { rows } = await executor.query(
    'SELECT * FROM subscription_payments WHERE mollie_payment_id = $1 FOR UPDATE',
    [molliePaymentId],
  )
  return rows[0] ?? null
}

export async function fetchPaymentByMollieId(executor, molliePaymentId) {
  const { rows } = await executor.query(
    'SELECT * FROM subscription_payments WHERE mollie_payment_id = $1',
    [molliePaymentId],
  )
  return rows[0] ?? null
}

// All nonterminal payments for one subscription — the manual sync button
// re-ingests these when webhooks are disabled in local dev.
export async function listNonterminalPaymentsForSubscription(executor, subscriptionId) {
  const { rows } = await executor.query(
    `SELECT * FROM subscription_payments
     WHERE subscription_id = $1 AND status IN ('open', 'pending')`,
    [subscriptionId],
  )
  return rows
}

// Nonterminal payments older than a grace window — the reconcile poll re-fetches
// these from the provider (lost webhooks, SEPA settlement, in-flight plan-change
// or downgrade-activation charges) and re-runs ingestion.
export async function listStaleNonterminalPayments(executor, olderThanMs) {
  const { rows } = await executor.query(
    `SELECT sp.*, s.user_id
     FROM subscription_payments sp
     JOIN subscriptions s ON s.id = sp.subscription_id
     WHERE sp.status IN ('open', 'pending')
       AND sp.updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
     ORDER BY sp.updated_at ASC`,
    [olderThanMs],
  )
  return rows
}
