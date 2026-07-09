// Pure request/query validation for reimbursement routes. No DB access here.
import { isValidIsoDate, parsePositiveId as parseId } from './common.js'
import { buildPeriodWhere } from '../utils/periodQuery.js'

export { isValidIsoDate, parseId }

export function buildReimbursementPeriodWhere(query) {
  return buildPeriodWhere(query, 'r.paid_on')
}
