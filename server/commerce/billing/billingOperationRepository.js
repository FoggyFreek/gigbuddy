// The outbox for remote payment-provider calls. A row is committed BEFORE every
// provider mutation so a crash mid-saga is recoverable: the idempotency_key
// (also sent to the provider) lets a resumed saga or the reconciliation job
// recognize an in-flight operation instead of issuing a duplicate charge/cancel.
//
// Pure SQL; every function takes an executor first.

// Claim (or re-claim) an operation by its idempotency key. Idempotent: a
// resumed saga calling this again gets the EXISTING row back — including its
// current status, so a caller can skip a provider call that already succeeded.
export async function claimOperation(executor, {
  userId, subscriptionId = null, opType, idempotencyKey, commandPayload,
}) {
  const { rows } = await executor.query(
    `INSERT INTO billing_operations
       (user_id, subscription_id, op_type, idempotency_key, command_payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO UPDATE
       SET command_payload = COALESCE(billing_operations.command_payload, EXCLUDED.command_payload)
     RETURNING *`,
    [userId, subscriptionId, opType, idempotencyKey, commandPayload],
  )
  return rows[0]
}

export async function beginOperationAttempt(executor, id, leaseMs) {
  const { rows } = await executor.query(
    `UPDATE billing_operations
        SET attempt_count = attempt_count + 1,
            lease_expires_at = NOW() + ($2::bigint * INTERVAL '1 millisecond'),
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('pending', 'failed_retryable')
        AND command_payload IS NOT NULL
        AND next_attempt_at <= NOW()
        AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
      RETURNING *`,
    [id, leaseMs],
  )
  return rows[0] ?? null
}

export async function markOperationSucceeded(executor, id, {
  mollieResourceId = null, resultPayload = null,
} = {}) {
  const { rows } = await executor.query(
    `UPDATE billing_operations
        SET status = 'succeeded',
            mollie_resource_id = COALESCE($2, mollie_resource_id),
            result_payload = COALESCE($3, result_payload),
            last_error_code = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, mollieResourceId, resultPayload],
  )
  return rows[0] ?? null
}

export async function markOperationFailed(executor, id, {
  status, lastErrorCode, retryAfterMs = 0,
}) {
  const { rows } = await executor.query(
    `UPDATE billing_operations
        SET status = $2,
            last_error_code = $3,
            lease_expires_at = NULL,
            next_attempt_at = NOW() + ($4::bigint * INTERVAL '1 millisecond'),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, status, lastErrorCode, retryAfterMs],
  )
  return rows[0] ?? null
}

export async function markOperationCompleted(executor, id) {
  const { rows } = await executor.query(
    `UPDATE billing_operations
        SET completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id],
  )
  return rows[0] ?? null
}

export async function fetchOperationByKey(executor, idempotencyKey) {
  const { rows } = await executor.query(
    'SELECT * FROM billing_operations WHERE idempotency_key = $1',
    [idempotencyKey],
  )
  return rows[0] ?? null
}

export async function fetchOperationById(executor, id) {
  const { rows } = await executor.query(
    'SELECT * FROM billing_operations WHERE id = $1', [id],
  )
  return rows[0] ?? null
}

// Work whose lease expired, whose retry delay elapsed, or whose provider result
// still needs its idempotent local completion step.
export async function listRecoverableOperations(executor, limit = 100) {
  const { rows } = await executor.query(
    `SELECT * FROM billing_operations
      WHERE completed_at IS NULL
        AND command_payload IS NOT NULL
        AND (
          status IN ('succeeded', 'failed_terminal')
          OR (
            status IN ('pending', 'failed_retryable')
            AND next_attempt_at <= NOW()
            AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
          )
        )
      ORDER BY next_attempt_at ASC, id ASC
      LIMIT $1`,
    [limit],
  )
  return rows
}

export async function listUnreplayableOperations(executor, olderThanMs) {
  const { rows } = await executor.query(
    `SELECT * FROM billing_operations
      WHERE completed_at IS NULL
        AND command_payload IS NULL
        AND status IN ('pending', 'failed_retryable')
        AND updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
      ORDER BY updated_at ASC`,
    [olderThanMs],
  )
  return rows
}
