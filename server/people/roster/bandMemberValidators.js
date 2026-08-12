// Input parsing and validation for band-member routes. No DB access here.
import { parsePositiveId as parseId } from '../../validators/common.js'
import { BAND_MEMBER_ROLE_OPTIONS } from '../../../shared/bandMemberRoles.js'

export const MEMBER_FIELDS = ['name', 'roles', 'color', 'sort_order', 'position']
export const VALID_POSITIONS = ['lead', 'optional', 'sub']
const VALID_ROLES = new Set(BAND_MEMBER_ROLE_OPTIONS)

export { parseId }

export function validateMemberRoles(roles) {
  if (!Array.isArray(roles)) return 'roles must be an array'
  if (roles.some((role) => typeof role !== 'string' || !VALID_ROLES.has(role))) {
    return 'roles contains an invalid role'
  }
  if (new Set(roles).size !== roles.length) return 'roles must not contain duplicates'
  return null
}

// Builds SET fragments ($1..$N) from the allowed PATCH fields.
export function buildMemberUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of MEMBER_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }
  return { fields, values }
}
