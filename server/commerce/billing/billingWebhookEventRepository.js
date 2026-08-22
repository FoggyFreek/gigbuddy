// Durable webhook-delivery audit. This records only provider identifiers and
// normalized error codes; exception messages and secrets never enter the row.

export async function recordWebhookReceived(executor, { subscriptionId, providerPaymentId }) {
  const { rows } = await executor.query(
    `INSERT INTO billing_webhook_events
       (subscription_id, provider_payment_id, status)
     VALUES ($1, $2, 'received')
     RETURNING id`,
    [subscriptionId, providerPaymentId],
  )
  return rows[0]
}

export async function markWebhookProcessed(executor, eventId) {
  await executor.query(
    `UPDATE billing_webhook_events
        SET status = 'processed', error_code = NULL, processed_at = NOW()
      WHERE id = $1`,
    [eventId],
  )
}

export async function markWebhookFailed(executor, eventId, errorCode) {
  await executor.query(
    `UPDATE billing_webhook_events
        SET status = 'failed', error_code = $2, processed_at = NOW()
      WHERE id = $1`,
    [eventId, errorCode],
  )
}
