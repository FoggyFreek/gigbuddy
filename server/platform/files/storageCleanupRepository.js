// Data-access helpers for the storage cleanup queue (migration 101): object
// keys whose deletion must be retried until confirmed. Drained by the billing
// reconciliation job.

export async function enqueueCleanup(executor, tenantId, objectKey, releaseReservation) {
  await executor.query(
    `INSERT INTO storage_cleanup_queue (tenant_id, object_key, release_reservation)
     VALUES ($1, $2, $3)
     ON CONFLICT (object_key) DO NOTHING`,
    [tenantId, objectKey, releaseReservation],
  )
}

export async function listCleanupQueue(executor, limit = 100) {
  const { rows } = await executor.query(
    'SELECT * FROM storage_cleanup_queue ORDER BY enqueued_at ASC, id ASC LIMIT $1',
    [limit],
  )
  return rows
}

export async function deleteCleanupRow(executor, id) {
  await executor.query('DELETE FROM storage_cleanup_queue WHERE id = $1', [id])
}

export async function bumpCleanupAttempts(executor, id) {
  const { rows } = await executor.query(
    'UPDATE storage_cleanup_queue SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
    [id],
  )
  return rows[0]?.attempts ?? null
}
