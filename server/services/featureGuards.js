// Advisory-lock helpers that close the purge-vs-write races around
// downgrades. Two distinct helpers on purpose:
//
//   withTenantFeatureLock  — lock-only. Used by the purge's per-feature delete
//                            transaction; no entitlement recheck (the purge
//                            runs precisely when the feature is off).
//   withFeatureWriteGuard  — the same per-tenant advisory lock PLUS an
//                            in-transaction effective-entitlement recheck.
//                            Used by writes into purgeable-feature tables, so
//                            either ordering with a concurrent purge is safe:
//                            write-first → the purge enumerates and deletes
//                            the new row; purge-first → the write's recheck
//                            sees the feature off and aborts (403).
//
// Because the purge always runs AFTER the plan switch has committed, the
// recheck reading the committed subscription state is authoritative.
//
// withIntegrationWriteLock is session-level (not transaction-scoped) because
// integration mutations mix remote provider calls with local persistence and
// must never hold a DB transaction open across the remote call. The purge's
// integrations phase takes the same lock, so a payment-link create can't race
// the key retain/delete decision.
import { resolveTenantEntitlements } from './entitlementService.js'
import { enqueueCleanup } from '../repositories/storageCleanupRepository.js'

// Matches the requireEntitlement middleware denial; the global error handler
// surfaces status/code/feature.
export class EntitlementRequiredError extends Error {
  constructor(feature) {
    super('This feature is not included in the current subscription plan')
    this.name = 'EntitlementRequiredError'
    this.status = 403
    this.code = 'entitlement_required'
    this.feature = feature
  }
}

// One transaction under the tenant's advisory lock. `fn(client)` runs inside;
// commit on success, rollback on throw.
export async function withTenantFeatureLock(db, tenantId, fn) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [tenantId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Write guard for purgeable-feature inserts/updates: tenant advisory lock +
// in-transaction effective-entitlement recheck. An ownerless tenant (resolver
// returns null) always passes — enforcement is skipped for legacy tenants.
// `orphanKey`: a storage object already uploaded for this write; when the
// recheck aborts, the key is enqueued for cleanup IN THE SAME transaction so
// nothing is orphaned (the reservation is released by the drain's recompute).
export async function withFeatureWriteGuard(db, tenantId, feature, fn, { orphanKey = null } = {}) {
  const client = await db.connect()
  let denied = false
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [tenantId])
    const resolved = await resolveTenantEntitlements(client, tenantId)
    denied = resolved !== null && resolved.entitlements.features[feature] !== true
    if (denied && orphanKey) await enqueueCleanup(client, tenantId, orphanKey, true)
    const result = denied ? null : await fn(client)
    await client.query('COMMIT')
    if (denied) throw new EntitlementRequiredError(feature)
    return result
  } catch (err) {
    if (!(err instanceof EntitlementRequiredError)) {
      await client.query('ROLLBACK').catch(() => {})
    }
    throw err
  } finally {
    client.release()
  }
}

// Session-level per-tenant lock serializing integration mutations that mix
// remote (Mollie) and local work with the integrations purge. Held on one
// checked-out client across the whole remote+local workflow; released in
// finally on that same client (session advisory locks belong to the
// connection). `fn(client)` may use the client or the pool for queries.
export async function withIntegrationWriteLock(db, tenantId, fn) {
  const client = await db.connect()
  const lockName = `integration_write:${tenantId}`
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockName])
    try {
      return await fn(client)
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]).catch(() => {})
    }
  } finally {
    client.release()
  }
}
