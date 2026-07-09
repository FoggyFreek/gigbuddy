// Input parsing and validation for band-member routes. No DB access here.
import { parsePositiveId as parseId } from './common.js'

export const MEMBER_FIELDS = ['name', 'role', 'color', 'sort_order', 'position']
export const VALID_POSITIONS = ['lead', 'optional', 'sub']

export { parseId }

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
