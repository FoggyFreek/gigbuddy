// Pure request/query validation for reimbursement routes. No DB access here.
import { isValidIsoDate, parsePositiveId as parseId } from '../../platform/http/requestValidators.js'
import { buildPeriodWhere } from '../../utils/periodQuery.js'

export { isValidIsoDate, parseId }

export function buildReimbursementPeriodWhere(query, fiscalYearStart) {
  return buildPeriodWhere(query, 'r.paid_on', 2, fiscalYearStart)
}
