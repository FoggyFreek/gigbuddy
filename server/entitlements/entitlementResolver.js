// Entitlement resolution: what a tenant is allowed to do, derived from its
// owner's subscription. The resolver enforces ALL time bounds itself — the
// billing scheduler only repairs durable status; access never depends on it
// running.
//
// A user holds ONE subscription made of modules, one per audience. Tenant kind
// selects the module: a band tenant resolves through the band module, a
// personal workspace through the artist module. A missing module is not an
// error — it resolves to that ladder's free fallback plan, which is exactly
// what "this customer did not buy that product" means.
//
// Contract: resolveTenantEntitlements(db, tenantId) →
//   null                                  — tenant has no owner: enforcement
//                                           is fully skipped (legacy tenants)
//   { entitlements: { features, limits },
//     planSlug, subscriptionStatus,
//     locked, financeReadOnly }           — resolved state
//
// "Locked" means the owner has no usable module on that ladder right now; the
// tenant falls back to the fallback plan's entitlements (fallback-lock) — data
// is never deleted by a lapse.
import {
  FEATURES,
  LIMIT_KEYS,
  PERIOD_GRACE_MS,
  mergeEntitlements,
} from '../auth/entitlements.js'
import { PLAN_AUDIENCES, audienceForTenantKind } from '../../shared/planAudiences.js'
import { fetchFallbackPlan } from '../commerce/plans/planRepository.js'
import {
  fetchTenantOwnership,
  tenantHasFinanceData,
  fetchLiveModuleForUser,
  hasNonterminalRecurringPayment,
} from './entitlementRepository.js'

const DAY_MS = 24 * 60 * 60 * 1000
// The grace after a trial or paid period ends (covering renewal-payment lag)
// is shared with the frontend — see PERIOD_GRACE_MS in shared/entitlements.js.
// Max extension while a renewal charge is still nonterminal at Mollie
// (SEPA Direct Debit can take days to settle).
const IN_FLIGHT_EXTENSION_MS = 7 * DAY_MS
// How long a past_due subscription keeps access while Mollie retries.
const PAST_DUE_GRACE_MS = 14 * DAY_MS

const CACHE_TTL_MS = 60 * 1000

const fallbackPlanCache = new Map() // audience → { plan, expiresAt }
const financeDataCache = new Map() // tenantId → { value, expiresAt }

// Call when plan rows change (plan admin CRUD) so fallback-lock entitlements
// pick up edits within the same process immediately.
export function invalidatePlanCache() {
  fallbackPlanCache.clear()
}

// Test hook: reset all in-process caches.
export function clearEntitlementCaches() {
  fallbackPlanCache.clear()
  financeDataCache.clear()
}

async function getFallbackPlan(db, audience) {
  const now = Date.now()
  const cached = fallbackPlanCache.get(audience)
  if (cached && cached.expiresAt > now) return cached.plan
  const plan = await fetchFallbackPlan(db, audience)
  if (!plan) {
    // The catalog seeds a fallback per ladder and the service/DB rules keep
    // them — missing means the catalog is broken; fail loudly rather than guess
    // (falling back to the other ladder would grant the wrong product).
    throw new Error(`No fallback subscription plan configured for audience ${audience}`)
  }
  fallbackPlanCache.set(audience, { plan, expiresAt: now + CACHE_TTL_MS })
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

// Whether the SUBSCRIPTION is inside a period that grants access right now. All
// bounds are evaluated here, on read — an expired state locks even if no
// scheduler ever flipped it. Whether a particular ladder gets anything is a
// separate question, answered by the module.
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
    // pending_activation grants nothing until an authoritatively-paid charge.
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

// The owner-side view: the effective entitlements the user's module on ONE
// ladder grants, independent of any tenant. Fallback entitlements when the
// subscription is locked or the module is missing or not yet paid for; plan +
// overrides merged and snapshot-bound otherwise.
async function resolveOwnerEntitlements(db, userId, audience) {
  const row = await fetchLiveModuleForUser(db, userId, audience)
  // A module that exists but has not been paid for yet grants nothing; one
  // awaiting removal still grants, because the customer paid for this period.
  const moduleGrants = row?.module_id != null && row.module_status !== 'pending'
  const unlocked = moduleGrants && (await isUnlocked(db, row, Date.now()))

  let planSlug
  let entitlements
  if (unlocked) {
    planSlug = row.plan_slug
    entitlements = mergeEntitlements(row.plan_entitlements, row.entitlement_overrides)
    // A confirmed pending downgrade binds capacity growth immediately: numeric
    // limits become min(current, confirmed target) while features stay current.
    //
    // The snapshot is per MODULE, which is what keeps it on its own ladder. An
    // artist downgrade's snapshot carries `bands: 0`; reading it from the
    // subscription instead would zero the owner's band cap.
    if (row.pending_limits_snapshot) {
      entitlements.limits = applyLimitsSnapshot(entitlements.limits, row.pending_limits_snapshot)
    }
  } else {
    const fallback = await getFallbackPlan(db, audience)
    planSlug = fallback.slug
    entitlements = mergeEntitlements(fallback.entitlements, null)
    // A module bought but not yet activated grants no features, but its target
    // capacity binds now — the same rule a pending downgrade follows.
    if (row?.module_id != null && row.module_status === 'pending') {
      entitlements.limits = applyLimitsSnapshot(
        entitlements.limits,
        row.plan_entitlements?.limits ?? {},
      )
    }
  }

  return {
    entitlements,
    planSlug,
    subscriptionStatus: row?.status ?? null,
    locked: !unlocked,
  }
}

// The numeric limits a user's own subscription grants — used for user-level
// caps (bands), where there is no tenant to resolve through. Every user has
// limits (fallback plan when no module); only tenant-side enforcement has the
// ownerless bypass.
//
// Defaults to the band ladder: the only user-level cap is the band cap, which
// is a band-product entitlement. An artist plan's `bands` limit is vestigial
// and must never be consulted here.
export async function resolveUserLimits(db, userId, audience = PLAN_AUDIENCES.BAND) {
  const { entitlements } = await resolveOwnerEntitlements(db, userId, audience)
  return entitlements.limits
}

// `ownerUserId` / `tenantKind` are a fast path for callers already holding a
// locked tenant row. Both or neither — a half-supplied pair falls back to the
// read, because inventing the missing kind would resolve the wrong product.
export async function resolveTenantEntitlements(db, tenantId, { ownerUserId, tenantKind } = {}) {
  let owner = ownerUserId
  let kind = tenantKind
  if (owner === undefined || owner === null || kind === undefined || kind === null) {
    const row = await fetchTenantOwnership(db, tenantId)
    owner = row?.owner_user_id ?? null
    kind = row?.kind ?? null
  }
  if (owner === null) return null

  const resolved = await resolveOwnerEntitlements(db, owner, audienceForTenantKind(kind))
  const financeReadOnly =
    !resolved.entitlements.features[FEATURES.FINANCE] && (await hasFinanceDataCached(db, tenantId))

  return { ...resolved, financeReadOnly }
}
