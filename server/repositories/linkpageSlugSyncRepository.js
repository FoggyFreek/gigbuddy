export async function insertSlugSyncOperation(executor, attrs) {
  const { rows } = await executor.query(
    `INSERT INTO linkpage_slug_sync_operations
       (tenant_id, old_slug, new_slug, slug_revision)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [attrs.tenantId, attrs.oldSlug, attrs.newSlug, attrs.slugRevision],
  )
  return rows[0]
}

export async function listDueSlugSyncOperations(executor, limit = 50) {
  const { rows } = await executor.query(
    `SELECT operation.*
       FROM linkpage_slug_sync_operations operation
      WHERE operation.status = 'pending'
        AND operation.next_attempt_at <= NOW()
        AND NOT EXISTS (
          SELECT 1
            FROM linkpage_slug_sync_operations earlier
           WHERE earlier.tenant_id = operation.tenant_id
             AND earlier.status = 'pending'
             AND earlier.slug_revision < operation.slug_revision
        )
      ORDER BY operation.next_attempt_at, operation.id
      LIMIT $1`,
    [limit],
  )
  return rows
}

export async function fetchEligibleSlugSyncOperation(executor, operationId) {
  const { rows } = await executor.query(
    `SELECT operation.*
       FROM linkpage_slug_sync_operations operation
      WHERE operation.id = $1
        AND operation.status = 'pending'
        AND NOT EXISTS (
          SELECT 1
            FROM linkpage_slug_sync_operations earlier
           WHERE earlier.tenant_id = operation.tenant_id
             AND earlier.status = 'pending'
             AND earlier.slug_revision < operation.slug_revision
        )`,
    [operationId],
  )
  return rows[0] ?? null
}

export async function markSlugSyncCompleted(executor, operationId) {
  const { rows } = await executor.query(
    `UPDATE linkpage_slug_sync_operations
        SET status = 'completed',
            attempt_count = attempt_count + 1,
            last_error_code = NULL,
            completed_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [operationId],
  )
  return rows[0] ?? null
}

export async function scheduleSlugSyncRetry(executor, operationId, errorCode, delayMs) {
  const { rows } = await executor.query(
    `UPDATE linkpage_slug_sync_operations
        SET attempt_count = attempt_count + 1,
            next_attempt_at = NOW() + ($3::bigint * INTERVAL '1 millisecond'),
            last_error_code = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [operationId, errorCode, delayMs],
  )
  return rows[0] ?? null
}

export async function hasPendingSlugSync(executor, tenantId) {
  const { rows: [row] } = await executor.query(
    `SELECT EXISTS (
       SELECT 1 FROM linkpage_slug_sync_operations
        WHERE tenant_id = $1 AND status = 'pending'
     ) AS pending`,
    [tenantId],
  )
  return row.pending
}

export async function purgeCompletedSlugSyncOperations(executor, retentionDays = 30) {
  const { rowCount } = await executor.query(
    `DELETE FROM linkpage_slug_sync_operations
      WHERE status = 'completed'
        AND completed_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [retentionDays],
  )
  return rowCount
}
