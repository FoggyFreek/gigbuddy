// Entitlement resolution: what a tenant is allowed to do, derived from its
// owner's subscription. The resolver enforces ALL time bounds itself — the
// billing scheduler (later phase) only repairs durable status; access never
// depends on it running.
//
// Contract: resolveTenantEntitlements(db, tenantId) →
//   null                                  — tenant has no owner: enforcement
//                                           is fully skipped (legacy tenants)
//   { entitlements: { features, limits },
//     planSlug, subscriptionStatus,
//     locked, financeReadOnly }           — resolved state
//
// "Locked" means the owner has no usable subscription right now; the tenant
// falls back to the fallback plan's entitlements (fallback-lock) — data is
// never deleted by a lapse.
import {
  FEATURES,
  LIMIT_KEYS,
  mergeEntitlements,
} from '../auth/entitlements.js'
import { fetchFallbackPlan } from '../repositories/planRepository.js'
import {
  fetchLiveSubscriptionForUser,
  hasNonterminalRecurringPayment,
} from '../repositories/subscriptionRepository.js'
import {
  fetchTenantOwner,
  tenantHasFinanceData,
} from '../repositories/entitlementRepository.js'

const DAY_MS = 24 * 60 * 60 * 1000
// Grace after a trial or paid period ends before the account locks — covers
// renewal-payment processing lag.
const PERIOD_GRACE_MS = 2 * DAY_MS
// Max extension while a renewal charge is still nonterminal at Mollie
// (SEPA Direct Debit can take days to settle).
const IN_FLIGHT_EXTENSION_MS = 7 * DAY_MS
// How long a past_due subscription keeps access while Mollie retries.
const PAST_DUE_GRACE_MS = 14 * DAY_MS

const CACHE_TTL_MS = 60 * 1000

let fallbackPlanCache = null // { plan, expiresAt }
const financeDataCache = new Map() // tenantId → { value, expiresAt }

// Call when plan rows change (plan admin CRUD) so fallback-lock entitlements
// pick up edits within the same process immediately.
export function invalidatePlanCache() {
  fallbackPlanCache = null
}

// Test hook: reset all in-process caches.
export function clearEntitlementCaches() {
  fallbackPlanCache = null
  financeDataCache.clear()
}

async function getFallbackPlan(db) {
  const now = Date.now()
  if (fallbackPlanCache && fallbackPlanCache.expiresAt > now) return fallbackPlanCache.plan
  const plan = await fetchFallbackPlan(db)
  if (!plan) {
    // Migration 100 seeds the fallback and the service/DB rules keep it —
    // missing means the catalog is broken; fail loudly rather than guess.
    throw new Error('No fallback subscription plan configured')
  }
  fallbackPlanCache = { plan, expiresAt: now + CACHE_TTL_MS }
  return plan
}

async function hasFinanceDataCached(db, tenantId) {
  const now = Date.now()
  const cached = financeDataCache.get(tenantId)
  if (cached && cached.expiresAt > now) return cached.value
  const value = await tenantHasFinanceData(db, tenantId)
  financeDataCache.set(tenantId, { value, expiresAt: now + CACHE_TTL_MS })
  return value
}

function ms(value) {
  return value === null || value === undefined ? null : new Date(value).getTime()
}

// Whether the subscription grants access right now. All bounds are evaluated
// here, on read — an expired state locks even if no scheduler ever flipped it.
async function isUnlocked(db, sub, nowMs) {
  if (!sub) return false
  switch (sub.status) {
    case 'trialing': {
      const trialEnd = ms(sub.trial_ends_at)
      return trialEnd !== null && nowMs < trialEnd + PERIOD_GRACE_MS
    }
    case 'active': {
      if (sub.is_complimentary) {
        const expires = ms(sub.complimentary_expires_at)
        return expires === null || nowMs < expires
      }
      const periodEnd = ms(sub.current_period_end)
      if (periodEnd === null) return false
      // Cancel-at-period-end: no renewal is coming, so no grace window.
      if (sub.cancel_at_period_end) return nowMs < periodEnd
      if (nowMs < periodEnd + PERIOD_GRACE_MS) return true
      // A renewal charge still settling (SEPA) extends access, capped at +7d.
      if (nowMs < periodEnd + IN_FLIGHT_EXTENSION_MS && sub.current_period_start) {
        return hasNonterminalRecurringPayment(db, sub.id, sub.current_period_start)
      }
      return false
    }
    case 'past_due': {
      const since = ms(sub.past_due_since)
      return since !== null && nowMs < since + PAST_DUE_GRACE_MS
    }
    // pending_mandate / pending_activation grant nothing until paid.
    default:
      return false
  }
}

// Per-limit minimum where null means unlimited. A missing snapshot key leaves
// the current limit untouched.
function applyLimitsSnapshot(limits, snapshot) {
  const result = { ...limits }
  for (const key of LIMIT_KEYS) {
    if (!(key in snapshot)) continue
    const target = snapshot[key]
    const current = result[key]
    if (target === null) continue // unlimited target never lowers anything
    result[key] = current === null ? target : Math.min(current, target)
  }
  return result
}

// The owner-side view: the effective entitlements a user's own subscription
// grants, independent of any tenant. Fallback entitlements when locked or
// without a subscription; plan + overrides merged and snapshot-bound otherwise.
async function resolveOwnerEntitlements(db, userId) {
  const sub = await fetchLiveSubscriptionForUser(db, userId)
  const unlocked = await isUnlocked(db, sub, Date.now())

  let planSlug
  let entitlements
  if (unlocked) {
    planSlug = sub.plan_slug
    entitlements = mergeEntitlements(sub.plan_entitlements, sub.entitlement_overrides)
    // A confirmed pending downgrade binds capacity growth immediately: numeric
    // limits become min(current, confirmed target) while features stay current.
    if (sub.pending_limits_snapshot) {
      entitlements.limits = applyLimitsSnapshot(entitlements.limits, sub.pending_limits_snapshot)
    }
  } else {
    const fallback = await getFallbackPlan(db)
    planSlug = fallback.slug
    entitlements = mergeEntitlements(fallback.entitlements, null)
  }

  return {
    entitlements,
    planSlug,
    subscriptionStatus: sub?.status ?? null,
    locked: !unlocked,
  }
}

// The numeric limits a user's own subscription grants — used for user-level
// caps (bands), where there is no tenant to resolve through. Every user has
// limits (fallback plan when no subscription); only tenant-side enforcement
// has the ownerless bypass.
export async function resolveUserLimits(db, userId) {
  const { entitlements } = await resolveOwnerEntitlements(db, userId)
  return entitlements.limits
}

export async function resolveTenantEntitlements(db, tenantId, { ownerUserId } = {}) {
  const owner = ownerUserId === undefined ? await fetchTenantOwner(db, tenantId) : ownerUserId
  if (owner === null) return null

  const resolved = await resolveOwnerEntitlements(db, owner)
  const financeReadOnly =
    !resolved.entitlements.features[FEATURES.FINANCE] && (await hasFinanceDataCached(db, tenantId))

  return { ...resolved, financeReadOnly }
}
