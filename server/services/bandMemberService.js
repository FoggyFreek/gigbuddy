// Band-member domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { VALID_POSITIONS, buildMemberUpdateFields } from '../validators/bandMemberValidators.js'
import {
  listBandMembers,
  nextSortOrder,
  insertBandMember,
  updateBandMemberFields,
  deleteBandMember as deleteBandMemberRow,
} from '../repositories/bandMemberRepository.js'
import { enforceMemberCap } from './limitService.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

export async function listMembers(db, tenantId) {
  return listBandMembers(db, tenantId)
}

export async function createMember(db, tenantId, body) {
  const { name, role, color, position } = body
  if (!name) return badRequest('name is required')
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
      role: role ?? null,
      color: color ?? null,
      sortOrder,
      position: pos,
    })
    return { member }
  }, { db })
}

export async function patchMember(db, tenantId, memberId, body) {
  const built = buildMemberUpdateFields(body)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const member = await updateBandMemberFields(db, tenantId, memberId, built.fields, built.values)
  if (!member) return NOT_FOUND
  return { member }
}

export async function deleteMember(db, tenantId, memberId) {
  const deleted = await deleteBandMemberRow(db, memberId, tenantId)
  return deleted ? {} : NOT_FOUND
}
