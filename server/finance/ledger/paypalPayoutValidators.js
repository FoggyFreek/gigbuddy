import { isValidCalendarDate } from '../accounts/accountValidators.js'
import { parsePositiveId } from '../../validators/common.js'

function trimOrNull(value) {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

export function validateCustomPaypalPayout(body = {}) {
  const reference = trimOrNull(body.reference)
  if (!reference || reference.length > 120) {
    return { error: 'reference must be between 1 and 120 characters' }
  }
  if (!isValidCalendarDate(body.entry_date)) {
    return { error: 'entry_date must be an ISO date (YYYY-MM-DD)' }
  }
  const depositCents = Number(body.deposit_cents)
  if (!Number.isSafeInteger(depositCents) || depositCents <= 0) {
    return { error: 'deposit_cents must be a positive integer' }
  }
  const rawIds = Array.isArray(body.order_financial_ids) ? body.order_financial_ids : []
  if (!rawIds.length || rawIds.length > 100) {
    return { error: 'select between 1 and 100 PayPal orders' }
  }
  const orderFinancialIds = rawIds.map(parsePositiveId)
  if (orderFinancialIds.some((id) => id === null)
      || new Set(orderFinancialIds).size !== orderFinancialIds.length) {
    return { error: 'order_financial_ids must contain unique positive IDs' }
  }
  return {
    value: {
      reference,
      entryDate: body.entry_date,
      depositCents,
      orderFinancialIds,
      differenceAccountCode: trimOrNull(body.difference_account_code),
    },
  }
}
