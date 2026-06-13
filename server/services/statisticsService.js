import pool from '../db/index.js'
import { storageClient, BUCKET } from '../utils/storage.js'

// Per-tenant storage accounting. The source of truth is the object store:
// every tenant's files live under the key prefix `tenants/<id>/`, so the
// current usage is recomputed by listing that prefix and summing object sizes.
// storageService fires refreshTenantStorageForKey() after each mutation.

// Parse the owning tenant id out of an object key. Returns null for legacy /
// un-prefixed keys (which are read-only and never mutated).
export function tenantIdFromKey(key) {
  const m = /^tenants\/(\d+)\//.exec(key || '')
  return m ? Number(m[1]) : null
}

// List the tenant's prefix and sum object sizes + count. Source of truth.
export function computeTenantStorage(tenantId) {
  return new Promise((resolve, reject) => {
    let storageBytes = 0
    let objectCount = 0
    const stream = storageClient.listObjects(BUCKET, `tenants/${tenantId}/`, true)
    stream.on('data', (obj) => {
      storageBytes += obj.size || 0
      objectCount += 1
    })
    stream.on('error', reject)
    stream.on('end', () => resolve({ storageBytes, objectCount }))
  })
}

// Recompute and persist usage for one tenant. Serialized per tenant with a
// transaction-scoped advisory lock so two overlapping refreshes can't finish
// out of order and overwrite the newer total: the second caller blocks at the
// lock until the first commits, then re-lists fresh.
export async function refreshTenantStorage(tenantId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [tenantId])
    const { storageBytes, objectCount } = await computeTenantStorage(tenantId)
    await client.query(
      `INSERT INTO tenant_statistics (tenant_id, storage_bytes, object_count, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id)
       DO UPDATE SET storage_bytes = $2, object_count = $3, updated_at = NOW()`,
      [tenantId, storageBytes, objectCount],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// Best-effort refresh triggered by a storage mutation. Never throws (a stats
// failure must not break the upload/delete). Returns the promise so callers /
// tests can await it if they want to.
export function refreshTenantStorageForKey(key) {
  const tenantId = tenantIdFromKey(key)
  if (!tenantId) return Promise.resolve()
  return refreshTenantStorage(tenantId).catch((e) =>
    console.warn('tenant storage refresh failed:', e.message),
  )
}

// Read one tenant's usage. COALESCE so a tenant with no stats row yet still
// returns zeros instead of nothing.
export async function getTenantStatistics(tenantId) {
  const { rows } = await pool.query(
    `SELECT t.id AS tenant_id,
            COALESCE(s.storage_bytes, 0) AS storage_bytes,
            COALESCE(s.object_count, 0)  AS object_count,
            s.updated_at
       FROM tenants t
       LEFT JOIN tenant_statistics s ON s.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId],
  )
  return rows[0] || null
}

// Read usage for every tenant (super-admin view). Driven from `tenants` so a
// brand-new zero-usage tenant never disappears from the list.
export async function getAllTenantStatistics() {
  const { rows } = await pool.query(
    `SELECT t.id AS tenant_id,
            t.slug,
            t.band_name,
            COALESCE(s.storage_bytes, 0) AS storage_bytes,
            COALESCE(s.object_count, 0)  AS object_count,
            s.updated_at
       FROM tenants t
       LEFT JOIN tenant_statistics s ON s.tenant_id = t.id
      ORDER BY t.id`,
  )
  return rows
}

// Recompute usage for every tenant (super-admin backfill for tenants whose
// files predate this feature).
export async function refreshAllTenantStorage() {
  const { rows } = await pool.query('SELECT id FROM tenants ORDER BY id')
  for (const { id } of rows) {
    await refreshTenantStorage(id)
  }
}
