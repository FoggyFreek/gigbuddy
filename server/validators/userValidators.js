// Input parsing and validation for user/membership routes. No DB access here.
import { WRITE_ROLES } from '../auth/permissions.js'

export const ALLOWED_STATUS = new Set(['pending', 'approved', 'rejected'])
export const ALLOWED_ROLE = WRITE_ROLES

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Validates the membership PATCH body. Returns { error: { status, body } } or {}.
export function validateMembershipPatch(status, role) {
  if (status !== undefined && !ALLOWED_STATUS.has(status)) {
    return { error: { status: 400, body: { error: 'Invalid status' } } }
  }
  if (role !== undefined && !ALLOWED_ROLE.includes(role)) {
    return { error: { status: 400, body: { error: 'Invalid role' } } }
  }
  if (status === undefined && role === undefined) {
    return { error: { status: 400, body: { error: 'Nothing to update' } } }
  }
  return {}
}

// Builds the membership UPDATE SET fragments. Approving stamps approved_at/by;
// any other status clears them. Returns { sets, values }.
export function buildMembershipUpdate({ status, role, approverUserId }) {
  const sets = []
  const values = []
  let i = 1
  if (status !== undefined) {
    sets.push(`status = $${i++}`)
    values.push(status)
    if (status === 'approved') {
      sets.push('approved_at = NOW()', `approved_by_user_id = $${i++}`)
      values.push(approverUserId)
    } else {
      sets.push('approved_at = NULL', 'approved_by_user_id = NULL')
    }
  }
  if (role !== undefined) {
    sets.push(`role = $${i++}`)
    values.push(role)
  }
  return { sets, values }
}

// Parses the band-member reassignment body. Returns { error } or { bandMemberId }
// where bandMemberId may be null (to clear the link).
export function parseBandMemberId(body) {
  const { band_member_id } = body
  if (band_member_id !== null && !Number.isInteger(band_member_id)) {
    return { error: 'band_member_id must be an integer or null' }
  }
  return { bandMemberId: band_member_id }
}
