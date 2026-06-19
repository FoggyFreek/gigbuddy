// Pure request/query validation for reimbursement routes. No DB access here.
import { buildPeriodWhere } from '../utils/periodQuery.js'

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string') return false
  return !Number.isNaN(Date.parse(value))
}

export function buildReimbursementPeriodWhere(query) {
  return buildPeriodWhere(query, 'r.paid_on')
}
