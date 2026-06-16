// Input parsing and validation for invite routes. No DB access here.
import { WRITE_ROLES } from '../auth/permissions.js'

export const ALLOWED_ROLES = WRITE_ROLES

// Invite ids only need to be integers (the route never enforced > 0).
export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) ? n : null
}

// Parses the optional expiry window. Returns { error } when out of range, or
// { expiresAt } (a Date, or null when no expiry was requested).
export function parseExpiresInDays(value) {
  if (value === undefined || value === null) return { expiresAt: null }
  const days = Number(value)
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return { error: 'expiresInDays must be a positive number ≤ 365' }
  }
  return { expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000) }
}
