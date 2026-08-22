function unresolvedWebhookFailureSql(alias = 'e') {
  return `${alias}.status = 'failed'
    AND NOT EXISTS (
      SELECT 1 FROM billing_webhook_events recovered
       WHERE recovered.subscription_id IS NOT DISTINCT FROM ${alias}.subscription_id
         AND recovered.provider_payment_id = ${alias}.provider_payment_id
         AND recovered.status = 'processed'
         AND recovered.received_at > ${alias}.received_at
    )`
}

const DRIFT_PREDICATE = `s.status <> 'canceled'
  AND s.is_complimentary = FALSE
  AND (
    s.mollie_schedule_stale = TRUE
    OR s.billing_repair_needed = TRUE
    OR (latest.status IN ('open', 'pending') AND latest.updated_at < NOW() - INTERVAL '1 hour')
    OR (s.status = 'active' AND latest.status IN ('failed', 'canceled', 'expired'))
    OR (s.status = 'past_due' AND latest.status = 'paid')
  )`

export async function fetchOperationsSummary(executor) {
  const { rows } = await executor.query(
    `SELECT
       (SELECT COUNT(*)::int FROM billing_operations
         WHERE status = 'failed_terminal' AND updated_at >= NOW() - INTERVAL '24 hours') AS terminal_operations,
       (SELECT COUNT(*)::int FROM billing_operations
         WHERE status = 'failed_retryable' AND completed_at IS NULL) AS retrying_operations,
       (SELECT COUNT(*)::int FROM billing_operations
         WHERE status IN ('pending', 'failed_retryable') AND completed_at IS NULL) AS pending_operations,
       (SELECT MIN(created_at) FROM billing_operations
         WHERE status IN ('pending', 'failed_retryable') AND completed_at IS NULL) AS oldest_pending_at,
       (SELECT COUNT(*)::int FROM billing_webhook_events e
         WHERE ${unresolvedWebhookFailureSql('e')}) AS unresolved_webhook_failures,
       (SELECT COUNT(*)::int
          FROM subscriptions s
          LEFT JOIN LATERAL (
            SELECT sp.status, sp.updated_at
              FROM subscription_payments sp
             WHERE sp.subscription_id = s.id
             ORDER BY COALESCE(sp.mollie_created_at, sp.created_at) DESC, sp.id DESC
             LIMIT 1
          ) latest ON TRUE
         WHERE ${DRIFT_PREDICATE}) AS status_drift`,
  )
  return rows[0]
}

export async function listBillingOperationAlerts(executor, limit) {
  const { rows } = await executor.query(
    `SELECT bo.id, bo.user_id, bo.subscription_id, bo.op_type, bo.status,
            bo.attempt_count, bo.last_error_code, bo.next_attempt_at,
            bo.created_at, bo.updated_at, u.name AS user_name, u.email AS user_email
       FROM billing_operations bo
       JOIN users u ON u.id = bo.user_id
      WHERE bo.status = 'failed_terminal'
         OR (bo.completed_at IS NULL AND bo.status IN ('pending', 'failed_retryable'))
      ORDER BY CASE bo.status
                 WHEN 'failed_terminal' THEN 0
                 WHEN 'failed_retryable' THEN 1
                 ELSE 2
               END,
               bo.updated_at DESC, bo.id DESC
      LIMIT $1`,
    [limit],
  )
  return rows
}

export async function listUnresolvedWebhookFailures(executor, limit) {
  const { rows } = await executor.query(
    `SELECT e.id, e.subscription_id, e.provider_payment_id, e.error_code,
            e.received_at, u.name AS user_name, u.email AS user_email
       FROM billing_webhook_events e
       LEFT JOIN subscriptions s ON s.id = e.subscription_id
       LEFT JOIN users u ON u.id = s.user_id
      WHERE ${unresolvedWebhookFailureSql('e')}
      ORDER BY e.received_at DESC, e.id DESC
      LIMIT $1`,
    [limit],
  )
  return rows
}

export async function listStatusDriftAlerts(executor, limit) {
  const { rows } = await executor.query(
    `SELECT s.id AS subscription_id, s.status AS subscription_status,
            s.mollie_schedule_stale, s.billing_repair_needed,
            u.name AS user_name, u.email AS user_email,
            latest.mollie_payment_id, latest.status AS payment_status,
            latest.updated_at AS payment_updated_at,
            COALESCE(
              latest.status IN ('open', 'pending')
                AND latest.updated_at < NOW() - INTERVAL '1 hour',
              FALSE
            ) AS stale_payment
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN LATERAL (
         SELECT sp.mollie_payment_id, sp.status, sp.updated_at, sp.mollie_created_at, sp.created_at
           FROM subscription_payments sp
          WHERE sp.subscription_id = s.id
          ORDER BY COALESCE(sp.mollie_created_at, sp.created_at) DESC, sp.id DESC
          LIMIT 1
       ) latest ON TRUE
      WHERE ${DRIFT_PREDICATE}
      ORDER BY s.billing_repair_needed DESC, s.mollie_schedule_stale DESC,
               latest.updated_at ASC NULLS LAST, s.id DESC
      LIMIT $1`,
    [limit],
  )
  return rows
}
