// Local record of refunds against subscription payments. The provider is the
// authority on whether the money moved; these rows are the durable intent, so a
// crash between "we decided to refund" and the provider call is recoverable.

export async function insertRefund(executor, {
  subscriptionId, subscriptionPaymentId, amountCents, reason, note = null, requestedByUserId = null,
}) {
  const { rows } = await executor.query(
    `INSERT INTO subscription_refunds
       (subscription_id, subscription_payment_id, amount_cents, reason, note, requested_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [subscriptionId, subscriptionPaymentId, amountCents, reason, note, requestedByUserId],
  )
  return rows[0]
}

export async function markRefundSucceeded(executor, id, providerRefundId) {
  await executor.query(
    `UPDATE subscription_refunds
        SET status = 'succeeded', mollie_refund_id = $2, updated_at = NOW()
      WHERE id = $1`,
    [id, providerRefundId],
  )
}

export async function markRefundFailed(executor, id) {
  await executor.query(
    "UPDATE subscription_refunds SET status = 'failed', updated_at = NOW() WHERE id = $1",
    [id],
  )
}

// How much of a payment is already spoken for. A failed refund does not count —
// the money never left — so the operator can try again for the same amount.
export async function sumRefundedForPayment(executor, subscriptionPaymentId) {
  const { rows } = await executor.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total
       FROM subscription_refunds
      WHERE subscription_payment_id = $1 AND status <> 'failed'`,
    [subscriptionPaymentId],
  )
  return rows[0].total
}

export async function listRefundsForSubscription(executor, subscriptionId) {
  const { rows } = await executor.query(
    `SELECT r.*, p.mollie_payment_id, p.kind AS payment_kind
       FROM subscription_refunds r
       JOIN subscription_payments p ON p.id = r.subscription_payment_id
      WHERE r.subscription_id = $1
      ORDER BY r.created_at DESC`,
    [subscriptionId],
  )
  return rows
}

// Refund intents that were committed but whose provider call never completed —
// the scheduler resumes them through the same outbox op.
export async function listPendingRefunds(executor, olderThanMs) {
  const { rows } = await executor.query(
    `SELECT r.*, p.mollie_payment_id, s.user_id
       FROM subscription_refunds r
       JOIN subscription_payments p ON p.id = r.subscription_payment_id
       JOIN subscriptions s ON s.id = r.subscription_id
      WHERE r.status = 'pending'
        AND r.created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
    [olderThanMs],
  )
  return rows
}
