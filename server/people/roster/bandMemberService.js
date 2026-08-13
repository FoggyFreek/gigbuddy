// Band-member domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import {
  VALID_POSITIONS,
  buildMemberUpdateFields,
  validateMemberRoles,
} from './bandMemberValidators.js'
import {
  listBandMembers,
  nextSortOrder,
  insertBandMember,
  updateBandMemberFields,
  deleteBandMember as deleteBandMemberRow,
  fetchBandMemberForUpdate,
  syncLeadIntoCurrentEvents,
  removeMemberFromCurrentEvents,
} from './bandMemberRepository.js'
import { enforceMemberCap } from '../../commerce/billing/limitService.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import { lockTenantRow } from '../workspaces/tenantRepository.js'

const NOT_FOUND = notFound('Not found')

export async function listMembers(db, tenantId) {
  return listBandMembers(db, tenantId)
}

export async function createMember(db, tenantId, body, actorUserId = null) {
  const { name, roles = [], color, position } = body
  if (!name) return badRequest('name is required')
  const rolesError = validateMemberRoles(roles)
  if (rolesError) return badRequest(rolesError)
  const pos = position ?? 'lead'
  if (!VALID_POSITIONS.includes(pos)) {
    return badRequest('position must be lead, optional, or sub')
  }

  // Roster rows count against the plan's member limit; the cap check and the
  // insert share a transaction (tenant-row lock) so parallel adds serialize.
  return withTransaction(async (client) => {
    const capError = await enforceMemberCap(client, tenantId, 'roster')
    if (capError) abortTransaction(capError)
    const sortOrder = await nextSortOrder(client, tenantId)
    const member = await insertBandMember(client, tenantId, {
      name,
      roles,
      color: color ?? null,
      sortOrder,
      position: pos,
    })
    if (member.position === 'lead') {
      await syncLeadIntoCurrentEvents(client, tenantId, member.id, actorUserId)
    }
    return { member }
  }, { db })
}

export async function patchMember(
  db,
  tenantId,
  memberId,
  body,
  actorUserId = null,
  tenantKind = 'band',
) {
  if ('roles' in body) {
    const rolesError = validateMemberRoles(body.roles)
    if (rolesError) return badRequest(rolesError)
  }
  const built = buildMemberUpdateFields(body)
  if (!built.fields.length) return badRequest('No valid fields to update')

  return withTransaction(async (client) => {
    // Profile renames lock tenants before the fixed personal member. Take the
    // same order here so the two debounced profile saves cannot deadlock.
    if (tenantKind === 'personal') {
      const tenant = await lockTenantRow(client, tenantId)
      if (!tenant || tenant.kind !== 'personal') abortTransaction(NOT_FOUND)
    }
    const previous = await fetchBandMemberForUpdate(client, memberId, tenantId)
    if (!previous) abortTransaction(NOT_FOUND)
    if (tenantKind === 'personal' && previous.user_id == null) abortTransaction(NOT_FOUND)
    const member = await updateBandMemberFields(client, tenantId, memberId, built.fields, built.values)
    if (!member) abortTransaction(NOT_FOUND)
    if (previous.position !== member.position) {
      if (member.position === 'lead') {
        await syncLeadIntoCurrentEvents(client, tenantId, member.id, actorUserId)
      } else if (previous.position === 'lead') {
        await removeMemberFromCurrentEvents(client, tenantId, member.id)
      }
    }
    return { member }
  }, { db })
}

export async function deleteMember(db, tenantId, memberId) {
  return withTransaction(async (client) => {
    const member = await fetchBandMemberForUpdate(client, memberId, tenantId)
    if (!member) abortTransaction(NOT_FOUND)
    await removeMemberFromCurrentEvents(client, tenantId, memberId)
    const deleted = await deleteBandMemberRow(client, memberId, tenantId)
    if (!deleted) abortTransaction(NOT_FOUND)
    return {}
  }, { db })
}
