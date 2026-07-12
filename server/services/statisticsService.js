import pool from '../db/index.js'
import { storageClient, BUCKET } from '../utils/storage.js'
import { logger } from '../utils/logger.js'
import {
  lockTenantStatistics,
  upsertTenantStatistics,
  ensureTenantStatistics,
  getStorageBytes,
  incrementStorageUsage,
  decrementStorageUsage,
  getTenantStatistics as getTenantStatisticsRow,
  getAllTenantStatistics as getAllTenantStatisticsRows,
  listTenantIds,
} from '../repositories/statisticsRepository.js'

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
    await lockTenantStatistics(client, tenantId)
    const { storageBytes, objectCount } = await computeTenantStorage(tenantId)
    await upsertTenantStatistics(client, tenantId, storageBytes, objectCount)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// Atomically reserves `sizeBytes` of quota before an upload. Serialized with
// refreshTenantStorage (same per-tenant advisory lock), so the check-then-
// increment can't interleave with a recompute or another reservation. Returns
// true when reserved; false when the reservation would exceed the limit.
// `limit` is either a byte cap (null for no cap — the reservation still
// happens, keeping usage accounting consistent) or an async resolver
// `(client) => limitBytes|null` invoked AFTER the advisory lock is held, so a
// concurrent downgrade committing a lower snapshot can never be outrun: the
// upload either resolves the old limit before the downgrade commits, or the
// snapshot-bound limit after — never the old limit under a committed snapshot.
export async function reserveStorageUsage(tenantId, sizeBytes, limit) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockTenantStatistics(client, tenantId)
    const limitBytes = typeof limit === 'function' ? await limit(client) : limit
    await ensureTenantStatistics(client, tenantId)
    const storageBytes = await getStorageBytes(client, tenantId)
    if (limitBytes !== null && storageBytes + sizeBytes > limitBytes) {
      await client.query('ROLLBACK')
      return false
    }
    await incrementStorageUsage(client, tenantId, sizeBytes)
    await client.query('COMMIT')
    return true
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// Releases a reservation after a failed upload once the object is confirmed
// absent. Clamped at zero so a duplicate release can't corrupt the counter.
export async function releaseStorageUsage(tenantId, sizeBytes) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockTenantStatistics(client, tenantId)
    await decrementStorageUsage(client, tenantId, sizeBytes)
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
  return refreshTenantStorage(tenantId).catch((err) =>
    logger.warn('tenant_storage.refresh_failed', { err, tenantId }),
  )
}

// Read one tenant's usage. COALESCE so a tenant with no stats row yet still
// returns zeros instead of nothing.
export async function getTenantStatistics(tenantId) {
  return getTenantStatisticsRow(pool, tenantId)
}

// Read usage for every tenant (super-admin view). Driven from `tenants` so a
// brand-new zero-usage tenant never disappears from the list.
export async function getAllTenantStatistics() {
  return getAllTenantStatisticsRows(pool)
}

// Recompute usage for every tenant (super-admin backfill for tenants whose
// files predate this feature).
export async function refreshAllTenantStorage() {
  for (const tenantId of await listTenantIds(pool)) {
    await refreshTenantStorage(tenantId)
  }
}
