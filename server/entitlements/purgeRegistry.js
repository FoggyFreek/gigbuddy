// The purge port. Billing owns WHEN entitlement-gated data is deleted; the
// domain that owns the data owns HOW. Each domain registers a handler for its
// feature here, so billing never learns what a ChordPro chart is.
//
// A handler is `(executor, tenantId) => Promise<void>`, or an object declaring
// the lock it needs:
//
//   { lock: 'transaction', run }  (default) — `run` receives the TRANSACTION
//     CLIENT of one short transaction taken under the tenant advisory lock that
//     every purgeable-feature write also takes. Row deletes and the storage
//     cleanup enqueue commit together.
//
//   { lock: 'session', run } — `run` receives THE POOL, inside a session-level
//     advisory lock with no transaction open. For handlers that mix remote
//     provider calls with local persistence and therefore must not hold a
//     transaction across the remote call.
//
// The executor argument differs between the two on purpose; a handler must use
// the one it is given and never reach for the pool itself.
import { PURGEABLE_FEATURES } from '../auth/entitlements.js'

const handlers = new Map()

// Registration happens at module load in the owning domain, so a duplicate is a
// programming error (two modules claiming one feature), not a runtime condition.
export function registerPurgeHandler(feature, handler) {
  if (handlers.has(feature)) {
    throw new Error(`Duplicate purge handler for ${feature}`)
  }
  if (!PURGEABLE_FEATURES.includes(feature)) {
    throw new Error(`Purge handler registered for non-purgeable feature ${feature}`)
  }
  const normalized = typeof handler === 'function'
    ? { lock: 'transaction', run: handler }
    : handler
  if (typeof normalized?.run !== 'function') {
    throw new Error(`Purge handler for ${feature} has no run function`)
  }
  if (normalized.lock !== 'transaction' && normalized.lock !== 'session') {
    throw new Error(`Purge handler for ${feature} has unknown lock ${normalized.lock}`)
  }
  handlers.set(feature, normalized)
}

export function getPurgeHandler(feature) {
  return handlers.get(feature) ?? null
}

export function registeredPurgeFeatures() {
  return [...handlers.keys()]
}

// Every purgeable feature must have an owner. A feature added to
// PURGEABLE_FEATURES without a handler would otherwise retain data a downgrade
// promised to delete, so the gap is fatal at load time rather than silent at
// purge time.
export function assertPurgeHandlersRegistered() {
  const missing = PURGEABLE_FEATURES.filter((feature) => !handlers.has(feature))
  if (missing.length > 0) {
    throw new Error(
      `No purge handler registered for purgeable feature(s): ${missing.join(', ')}`,
    )
  }
}
