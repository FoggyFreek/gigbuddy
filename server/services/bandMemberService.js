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

  const sortOrder = await nextSortOrder(db, tenantId)
  const member = await insertBandMember(db, tenantId, {
    name,
    role: role ?? null,
    color: color ?? null,
    sortOrder,
    position: pos,
  })
  return { member }
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
