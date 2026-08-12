// The outbox for remote payment-provider calls. A row is committed BEFORE every
// provider mutation so a crash mid-saga is recoverable: the idempotency_key
// (also sent to the provider) lets a resumed saga or the reconciliation job
// recognize an in-flight operation instead of issuing a duplicate charge/cancel.
//
// Pure SQL; every function takes an executor first.

// Claim (or re-claim) an operation by its idempotency key. Idempotent: a
// resumed saga calling this again gets the EXISTING row back — including its
// current status, so a caller can skip a provider call that already succeeded.
export async function claimOperation(executor, { userId, subscriptionId = null, opType, idempotencyKey }) {
  const { rows } = await executor.query(
    `INSERT INTO billing_operations (user_id, subscription_id, op_type, idempotency_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [userId, subscriptionId, opType, idempotencyKey],
  )
  return rows[0]
}

export async function markOperation(executor, id, status, { mollieResourceId = null, lastErrorCode = null } = {}) {
  const { rows } = await executor.query(
    `UPDATE billing_operations
     SET status = $2,
         mollie_resource_id = COALESCE($3, mollie_resource_id),
         last_error_code = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, status, mollieResourceId, lastErrorCode],
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

// Operations stuck 'pending' past a grace window — a crash after committing the
// op row but before/around the provider call. The reconciliation job adopts
// these (query provider by resource id / metadata → mark succeeded or failed).
export async function listStalePendingOperations(executor, olderThanMs) {
  const { rows } = await executor.query(
    `SELECT * FROM billing_operations
     WHERE status = 'pending'
       AND updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
     ORDER BY updated_at ASC`,
    [olderThanMs],
  )
  return rows
}
