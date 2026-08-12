// Data-access helpers for share photos. Each query takes an `executor` (a pool
// or transaction client) so callers control transactions. Every query is scoped
// by tenant_id.

export async function listSharePhotos(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, object_key, content_type, label, sort_order
     FROM share_photos WHERE tenant_id = $1
     ORDER BY sort_order, id`,
    [tenantId],
  )
  return rows
}

export async function nextSortOrder(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM share_photos WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0].next
}

export async function insertSharePhoto(executor, tenantId, { objectKey, contentType, label, sortOrder }) {
  const { rows } = await executor.query(
    `INSERT INTO share_photos (tenant_id, object_key, content_type, label, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, objectKey, contentType, label, sortOrder],
  )
  return rows[0]
}

export async function getSharePhotoObjectKey(executor, photoId, tenantId) {
  const { rows } = await executor.query(
    'SELECT object_key FROM share_photos WHERE id = $1 AND tenant_id = $2',
    [photoId, tenantId],
  )
  return rows[0]?.object_key ?? null
}

export async function deleteSharePhoto(executor, photoId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM share_photos WHERE id = $1 AND tenant_id = $2',
    [photoId, tenantId],
  )
  return rowCount > 0
}
