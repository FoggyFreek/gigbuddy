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
  lockBandMember,
  clearUserBandMember,
  assignBandMember,
} from '../repositories/userRepository.js'
import { enforceMemberCap } from './limitService.js'
import { badRequest, forbidden, notFound } from './serviceErrors.js'

function updateDenied(targetUserId, reason, extra = {}) {
  return { action: 'membership.update.denied', details: { targetUserId, ...extra, reason } }
}

function removeDenied(targetUserId, reason) {
  return { action: 'membership.remove.denied', details: { targetUserId, reason } }
}

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

  // Approving a membership consumes plan capacity: cap check + update in one
  // transaction under the tenant-row lock. Invite redemption (pending rows)
  // deliberately doesn't consume capacity — only approval does.
  if (status === 'approved' && existing.status !== 'approved') {
    const capError = await withTransaction(async (client) => {
      const err = await enforceMemberCap(client, tenantId, 'membership')
      if (err) abortTransaction(err)
      await updateMembership(client, tenantId, userId, sets, values)
      return null
    }, { db })
    if (capError) return capError
  } else {
    await updateMembership(db, tenantId, userId, sets, values)
  }

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

  await clearUserBandMember(db, userId, tenantId)
  await deleteMembership(db, tenantId, userId)
  return { audit: { action: 'membership.remove', details: { targetUserId: userId } } }
}
