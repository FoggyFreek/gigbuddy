export async function lockTenantStatistics(executor, tenantId) {
  await executor.query('SELECT pg_advisory_xact_lock($1)', [tenantId])
}

export async function upsertTenantStatistics(executor, tenantId, storageBytes, objectCount) {
  await executor.query(
    `INSERT INTO tenant_statistics (tenant_id, storage_bytes, object_count, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET storage_bytes = $2, object_count = $3, updated_at = NOW()`,
    [tenantId, storageBytes, objectCount],
  )
}

export async function ensureTenantStatistics(executor, tenantId) {
  await executor.query(
    'INSERT INTO tenant_statistics (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [tenantId],
  )
}

export async function getStorageBytes(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT storage_bytes FROM tenant_statistics WHERE tenant_id = $1',
    [tenantId],
  )
  return Number(rows[0].storage_bytes)
}

export async function incrementStorageUsage(executor, tenantId, sizeBytes) {
  await executor.query(
    `UPDATE tenant_statistics
     SET storage_bytes = storage_bytes + $2, object_count = object_count + 1, updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId, sizeBytes],
  )
}

export async function decrementStorageUsage(executor, tenantId, sizeBytes) {
  await executor.query(
    `UPDATE tenant_statistics
     SET storage_bytes = GREATEST(storage_bytes - $2, 0),
         object_count = GREATEST(object_count - 1, 0),
         updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId, sizeBytes],
  )
}

export async function getTenantStatistics(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT t.id AS tenant_id,
            COALESCE(s.storage_bytes, 0) AS storage_bytes,
            COALESCE(s.object_count, 0) AS object_count,
            s.updated_at
       FROM tenants t
       LEFT JOIN tenant_statistics s ON s.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId],
  )
  return rows[0] || null
}

export async function getAllTenantStatistics(executor) {
  const { rows } = await executor.query(
    `SELECT t.id AS tenant_id,
            t.slug,
            t.band_name,
            COALESCE(s.storage_bytes, 0) AS storage_bytes,
            COALESCE(s.object_count, 0) AS object_count,
            s.updated_at
       FROM tenants t
       LEFT JOIN tenant_statistics s ON s.tenant_id = t.id
      ORDER BY t.id`,
  )
  return rows
}

export async function listTenantIds(executor) {
  const { rows } = await executor.query('SELECT id FROM tenants ORDER BY id')
  return rows.map((row) => row.id)
}
