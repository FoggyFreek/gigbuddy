// Numeric limit enforcement (member and band caps). Callers MUST invoke these
// inside their own transaction, passing the transaction client: the FOR UPDATE
// row locks only protect the check-then-insert if the insert commits in the
// same transaction.
//
// Error contract: { error: { status: 409, body: { error, code, limit } } } on
// a hit cap, or null when the write may proceed.
import { resolveTenantEntitlements, resolveUserLimits } from './entitlementService.js'
import { LIMITS, isUnlimited } from '../auth/entitlements.js'
import {
  lockTenantForCapCheck,
  lockUserForCapCheck,
  countRosterMembers,
  countApprovedMemberships,
  countActiveOwnedTenants,
} from '../repositories/limitRepository.js'

function limitReached(error, code, limit) {
  return { error: { status: 409, body: { error, code, limit } } }
}

// Member cap: both roster rows (band_members) and approved memberships count
// against the plan's member limit — each is checked at its own insert/approval
// point. `kind` selects which counter this write increases.
export async function enforceMemberCap(client, tenantId, kind) {
  const ownerUserId = await lockTenantForCapCheck(client, tenantId)
  if (ownerUserId === undefined || ownerUserId === null) return null // missing or ownerless → no enforcement

  const resolved = await resolveTenantEntitlements(client, tenantId, { ownerUserId })
  const limit = resolved.entitlements.limits[LIMITS.MEMBERS]
  if (isUnlimited(limit)) return null

  const count = kind === 'roster'
    ? await countRosterMembers(client, tenantId)
    : await countApprovedMemberships(client, tenantId)
  if (count >= limit) {
    return limitReached('Member limit reached for the current plan', 'member_limit_reached', limit)
  }
  return null
}

// Band cap: how many active (non-archived) tenants a user may own. User-level
// — every user has limits (fallback plan without a subscription).
export async function enforceBandCap(client, userId) {
  await lockUserForCapCheck(client, userId)

  const limits = await resolveUserLimits(client, userId)
  const limit = limits[LIMITS.BANDS]
  if (isUnlimited(limit)) return null

  const count = await countActiveOwnedTenants(client, userId)
  if (count >= limit) {
    return limitReached('Band limit reached for the current plan', 'band_limit_reached', limit)
  }
  return null
}
