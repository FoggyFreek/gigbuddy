import { isValidCalendarDate } from '../../finance/accounts/accountValidators.js'
import { parsePositiveId } from '../../platform/http/requestValidators.js'

function trimOrNull(value) {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

export function validateManualPayoutSettlement(body = {}) {
  if (!isValidCalendarDate(body.entry_date)) {
    return { error: 'entry_date must be an ISO date (YYYY-MM-DD)' }
  }
  const rawMappings = Array.isArray(body.adjustment_mappings) ? body.adjustment_mappings : []
  const adjustmentMappings = []
  const seen = new Set()
  for (const raw of rawMappings) {
    const balanceTransactionId = parsePositiveId(raw?.balance_transaction_id)
    const accountCode = trimOrNull(raw?.account_code)
    if (balanceTransactionId === null || !accountCode) {
      return { error: 'invalid Shopify payout adjustment mapping' }
    }
    if (seen.has(balanceTransactionId)) {
      return { error: `duplicate Shopify adjustment mapping for ${balanceTransactionId}` }
    }
    seen.add(balanceTransactionId)
    adjustmentMappings.push({ balanceTransactionId, accountCode })
  }
  return {
    value: { entryDate: body.entry_date, adjustmentMappings },
  }
}

export function validatePayoutRefresh(body = {}) {
  if (!isValidCalendarDate(body.from_date) || !isValidCalendarDate(body.to_date)) {
    return { error: 'from_date and to_date must be ISO dates (YYYY-MM-DD)' }
  }
  if (body.from_date > body.to_date) return { error: 'from_date must not be after to_date' }
  const span = (new Date(`${body.to_date}T00:00:00Z`) - new Date(`${body.from_date}T00:00:00Z`)) / 86400000
  if (span > 366) return { error: 'payout refresh range cannot exceed 366 days' }
  return { value: { fromDate: body.from_date, toDate: body.to_date } }
}

export function validateCustomPayout(body = {}) {
  const reference = trimOrNull(body.reference)
  if (!reference || reference.length > 120) {
    return { error: 'reference must be between 1 and 120 characters' }
  }
  if (!isValidCalendarDate(body.issued_at)) {
    return { error: 'issued_at must be an ISO date (YYYY-MM-DD)' }
  }
  const netCents = Number(body.net_cents)
  if (!Number.isSafeInteger(netCents) || netCents <= 0) {
    return { error: 'net_cents must be a positive integer' }
  }
  const rawIds = Array.isArray(body.balance_transaction_ids)
    ? body.balance_transaction_ids
    : []
  if (!rawIds.length || rawIds.length > 100) {
    return { error: 'select between 1 and 100 Shopify payment contributions' }
  }
  const balanceTransactionIds = rawIds.map(parsePositiveId)
  if (balanceTransactionIds.some((id) => id === null)
      || new Set(balanceTransactionIds).size !== balanceTransactionIds.length) {
    return { error: 'balance_transaction_ids must contain unique positive IDs' }
  }
  return {
    value: {
      reference,
      issuedAt: body.issued_at,
      netCents,
      balanceTransactionIds,
    },
  }
}
