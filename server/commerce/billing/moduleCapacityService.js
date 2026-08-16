// Capacity audit: does the customer's CURRENT usage fit a target plan's limits?
//
// Distinct from limitService.js, which enforces a cap at the moment of a single
// growing write. This asks the opposite question — "may this module move DOWN
// to that plan?" — across every tenant of one ladder, archived included.
//
// With `lock: true` it acquires the exact lock set every capacity-growing write
// takes, so a member add / upload / band unarchive cannot slip past while the
// change commits. Preview runs it lock-free.
import {
  listOwnedTenants,
  fetchTenantCapacityUsage,
  advisoryLockTenant,
  lockUserForCapCheck,
  lockTenantForCapCheck,
} from './limitRepository.js'
import { LIMITS } from '../../auth/entitlements.js'
import { PLAN_AUDIENCES, tenantKindsForAudience } from '../../../shared/planAudiences.js'

const MB = 1024 * 1024

const NO_USAGE = { rosterMembers: 0, approvedMembers: 0, storageBytes: 0 }

// Pure: one tenant's measured usage against the target limits. Members first,
// then storage — the order the UI lists them in.
function blockersForTenant(tenant, usage, { membersLimit, storageLimitMb }) {
  const blockers = []
  if (membersLimit !== null) {
    // Roster rows and approved memberships are separate counters, each capped
    // at its own insert point; the larger one is what must fit.
    const current = Math.max(usage.rosterMembers, usage.approvedMembers)
    if (current > membersLimit) {
      blockers.push({ tenantId: tenant.id, tenantName: tenant.band_name, limit: LIMITS.MEMBERS, current, target: membersLimit })
    }
  }
  if (storageLimitMb !== null && usage.storageBytes > storageLimitMb * MB) {
    blockers.push({
      tenantId: tenant.id, tenantName: tenant.band_name, limit: LIMITS.STORAGE_MB,
      current: Math.ceil(usage.storageBytes / MB), target: storageLimitMb,
    })
  }
  return blockers
}

// `audience` scopes the whole check to that module's tenants: an artist module
// is measured against the personal workspace alone, a band module against the
// bands alone. That scoping is also what lets an artist module coexist with
// owned bands — the band cap below simply never runs for the artist ladder.
export async function computeModuleBlockers(executor, userId, targetLimits, { audience, lock = false } = {}) {
  const blockers = []
  if (lock) await lockUserForCapCheck(executor, userId)
  // Archived tenants are checked against the per-tenant limits too — they can
  // be unarchived onto the lower plan. Only the band cap counts active ones
  // (archiving is the documented way to satisfy it).
  const tenants = await listOwnedTenants(executor, userId, tenantKindsForAudience(audience))

  // Locks are taken BEFORE anything is measured, and in the id-ascending order
  // listOwnedTenants returns — that ordering is what makes concurrent downgrades
  // deadlock-free, so keep this a serial loop over that array.
  if (lock) {
    for (const tenant of tenants) {
      await lockTenantForCapCheck(executor, tenant.id)
      await advisoryLockTenant(executor, tenant.id)
    }
  }

  // The band cap belongs to the band product. An artist plan's `bands: 0` is
  // vestigial (enforceBandCap reads the band module), so applying it here would
  // block every artist module for anyone who owns a band.
  if (audience === PLAN_AUDIENCES.BAND) {
    const bandsLimit = targetLimits[LIMITS.BANDS]
    const activeCount = tenants.filter((t) => !t.archived_at).length
    if (bandsLimit !== null && activeCount > bandsLimit) {
      blockers.push({ tenantId: null, tenantName: null, limit: LIMITS.BANDS, current: activeCount, target: bandsLimit })
    }
  }

  const membersLimit = targetLimits[LIMITS.MEMBERS]
  const storageLimitMb = targetLimits[LIMITS.STORAGE_MB]
  // An unlimited plan measures nothing at all.
  if (tenants.length === 0 || (membersLimit === null && storageLimitMb === null)) return blockers

  const usage = await fetchTenantCapacityUsage(executor, tenants.map((t) => t.id))
  for (const tenant of tenants) {
    blockers.push(...blockersForTenant(tenant, usage.get(tenant.id) ?? NO_USAGE, { membersLimit, storageLimitMb }))
  }
  return blockers
}
