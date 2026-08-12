// Membership ("users" admin) domain logic. Route handlers stay thin and
// delegate here. Functions return { error: { status, body } } on expected
// failures and a domain payload on success. Audit events that need the request
// (ip/session) are returned as an `audit` { action, details } descriptor for the
// route to emit via auditLog(req, ...).
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import {
  validateMembershipPatch,
  buildMembershipUpdate,
  parseBandMemberId,
} from '../validators/userValidators.js'
import {
  listMemberships as listMembershipRows,
  readMembershipRow,
  updateMembership,
  deleteMembership,
  countOtherApprovedTenantAdmins,
  lockBandMember,
  clearUserBandMember,
  assignBandMember,
} from '../repositories/userRepository.js'
import { lockTenantRow } from '../repositories/tenantRepository.js'
import { enforceMemberCap } from './limitService.js'
import { badRequest, conflict, forbidden, notFound } from './serviceErrors.js'

function updateDenied(targetUserId, reason, extra = {}) {
  return { action: 'membership.update.denied', details: { targetUserId, ...extra, reason } }
}

function removeDenied(targetUserId, reason) {
  return { action: 'membership.remove.denied', details: { targetUserId, reason } }
}

function leaveDenied(tenantId, reason) {
  return { action: 'membership.leave.denied', details: { tenantId, reason } }
}

// A band the caller has no approved membership in must look exactly like one
// that does not exist, so every leave failure shares this response.
const NOT_A_MEMBER = notFound('Membership not found')

// Privileged-change gates that need the existing membership row. Returns
// { error, audit } on denial, or null when allowed.
function authorizeMembershipChange({ existing, status, role, callerIsSuperAdmin, userId, actingUserId }) {
  if (existing.is_super_admin && existing.user_id !== actingUserId && !callerIsSuperAdmin) {
    return {
      ...forbidden('Cannot modify a super admin membership'),
      audit: updateDenied(userId, 'modify_super_admin'),
    }
  }
  if (existing.role === 'tenant_admin' && role !== undefined && role !== 'tenant_admin' && !callerIsSuperAdmin) {
    return {
      ...forbidden('Only super admins can demote a tenant_admin'),
      audit: updateDenied(userId, 'demote_tenant_admin_requires_super_admin', { role }),
    }
  }
  // Approving a pending tenant_admin membership is effectively a grant of
  // tenant_admin powers — gate it to super admins regardless of how the pending
  // row got there (invite redemption, manual seed, etc.).
  if (status === 'approved' && existing.role === 'tenant_admin' && existing.status !== 'approved' && !callerIsSuperAdmin) {
    return {
      ...forbidden('Only super admins can approve a tenant_admin membership'),
      audit: updateDenied(userId, 'approve_tenant_admin_requires_super_admin', { status }),
    }
  }
  return null
}

// A tenant must always keep at least one approved tenant_admin: an adminless
// tenant can never be administered again from inside. The rule binds super
// admins too — the broken end state is the same however it was reached.
//
// `next` is the patch being applied, or null when the membership is going away
// entirely. Callers hold the tenant row lock, so a concurrent change to a
// DIFFERENT admin cannot slip between this count and their write.
async function assertTenantAdminRemains(client, tenantId, targetUserId, existing, next) {
  if (existing.role !== 'tenant_admin' || existing.status !== 'approved') return null

  if (next !== null) {
    // An absent field is unchanged, so it keeps whatever made them an admin.
    const keepsRole = (next.role ?? 'tenant_admin') === 'tenant_admin'
    const keepsStatus = (next.status ?? 'approved') === 'approved'
    if (keepsRole && keepsStatus) return null
  }

  const others = await countOtherApprovedTenantAdmins(client, tenantId, targetUserId)
  if (others > 0) return null

  return conflict('This band must keep at least one admin', { code: 'last_tenant_admin' })
}

// Atomically points the user at a band member: validates (and locks) the target
// before clearing the old link, so a missing target can't leave the user
// unlinked. Returns { error } | {}.
async function reassignBandMember(tenantId, userId, bandMemberId) {
  return withTransaction(async (client) => {
    if (bandMemberId !== null && !(await lockBandMember(client, bandMemberId, tenantId))) {
      abortTransaction(notFound('Band member not found in this tenant'))
    }

    // Clear the user's current link, then assign the new one (if any).
    await clearUserBandMember(client, userId, tenantId)
    if (bandMemberId !== null) {
      await assignBandMember(client, userId, bandMemberId, tenantId)
    }

    return {}
  })
}

// ---------- public API ----------

export async function listMemberships(db, tenantId) {
  return listMembershipRows(db, tenantId)
}

export async function patchMembership(db, tenantId, actingUser, userId, body) {
  const { status, role } = body
  const validation = validateMembershipPatch(status, role)
  if (validation.error) return { error: validation.error }

  const callerIsSuperAdmin = !!actingUser?.is_super_admin
  if (role === 'tenant_admin' && !callerIsSuperAdmin) {
    return {
      ...forbidden('Only super admins can grant tenant_admin'),
      audit: updateDenied(userId, 'grant_tenant_admin_requires_super_admin', { role }),
    }
  }

  const existing = await readMembershipRow(db, tenantId, userId)
  if (!existing) return notFound('Membership not found')

  const denial = authorizeMembershipChange({
    existing, status, role, callerIsSuperAdmin, userId, actingUserId: actingUser.id,
  })
  if (denial) return denial

  const { sets, values } = buildMembershipUpdate({ status, role, approverUserId: actingUser.id })

  // Every check-then-write runs in one transaction under the tenant-row lock:
  // the last-admin invariant always, and the member cap when this patch is the
  // approval that consumes capacity. Invite redemption (pending rows)
  // deliberately doesn't consume capacity — only approval does.
  const writeError = await withTransaction(async (client) => {
    await lockTenantRow(client, tenantId)

    const denial = await assertTenantAdminRemains(client, tenantId, userId, existing, { status, role })
    if (denial) abortTransaction({ ...denial, audit: updateDenied(userId, 'last_tenant_admin') })

    if (status === 'approved' && existing.status !== 'approved') {
      const capError = await enforceMemberCap(client, tenantId, 'membership')
      if (capError) abortTransaction(capError)
    }

    await updateMembership(client, tenantId, userId, sets, values)
    return null
  }, { db })
  if (writeError) return writeError

  const updated = await readMembershipRow(db, tenantId, userId)
  return {
    membership: updated,
    audit: {
      action: 'membership.update',
      details: {
        targetUserId: userId,
        ...(status !== undefined && { status }),
        ...(role !== undefined && { role }),
      },
    },
  }
}

export async function patchBandMember(db, tenantId, userId, body) {
  const parsed = parseBandMemberId(body)
  if (parsed.error) return badRequest(parsed.error)

  const membership = await readMembershipRow(db, tenantId, userId)
  if (!membership) return notFound('Membership not found')

  const result = await reassignBandMember(tenantId, userId, parsed.bandMemberId)
  if (result.error) return result

  return { membership: await readMembershipRow(db, tenantId, userId) }
}

export async function removeMembership(db, tenantId, actingUser, userId) {
  const callerIsSuperAdmin = !!actingUser?.is_super_admin
  const existing = await readMembershipRow(db, tenantId, userId)
  if (!existing) return notFound('Membership not found')

  if (existing.is_super_admin && !callerIsSuperAdmin) {
    return {
      ...forbidden('Cannot remove a super admin membership'),
      audit: removeDenied(userId, 'remove_super_admin'),
    }
  }
  if (existing.role === 'tenant_admin' && existing.user_id !== actingUser.id && !callerIsSuperAdmin) {
    return {
      ...forbidden('Only super admins can remove a tenant_admin'),
      audit: removeDenied(userId, 'remove_tenant_admin_requires_super_admin'),
    }
  }

  // The last-admin check and the delete share one transaction under the tenant
  // row lock. Note the gate above deliberately exempts self-removal from the
  // "only super admins remove a tenant_admin" rule, so this is the only thing
  // standing between an admin and leaving their own band adminless.
  const removal = await withTransaction(async (client) => {
    await lockTenantRow(client, tenantId)

    const denial = await assertTenantAdminRemains(client, tenantId, userId, existing, null)
    if (denial) abortTransaction({ ...denial, audit: removeDenied(userId, 'last_tenant_admin') })

    await clearUserBandMember(client, userId, tenantId)
    await deleteMembership(client, tenantId, userId)
    return {}
  }, { db })
  if (removal.error) return removal

  return { audit: { action: 'membership.remove', details: { targetUserId: userId } } }
}

// Self-service departure, from anywhere: a musician leaves a band from their own
// workspace, with no active tenant and no admin's warrant. It acts on the
// caller's OWN approved membership and nothing else, so there is no target-user
// parameter to abuse.
//
// Every miss is 404 — not a member, never was, already left, still pending —
// because a band the caller has no approved membership in must be
// indistinguishable from one that does not exist.
export async function leaveTenant(db, user, tenantId) {
  return withTransaction(async (client) => {
    await lockTenantRow(client, tenantId)

    const existing = await readMembershipRow(client, tenantId, user.id)
    if (!existing || existing.status !== 'approved') abortTransaction(NOT_A_MEMBER)

    const denial = await assertTenantAdminRemains(client, tenantId, user.id, existing, null)
    if (denial) abortTransaction({ ...denial, audit: leaveDenied(tenantId, 'last_tenant_admin') })

    await clearUserBandMember(client, user.id, tenantId)
    await deleteMembership(client, tenantId, user.id)

    // `tenantId` rides in the details because there is no active tenant on this
    // tier for the request context to supply — same as invite redemption.
    return { audit: { action: 'membership.leave', details: { tenantId } } }
  }, { db })
}
