import { isValidCalendarDate } from './accountValidators.js'

// Quarterly periods only (NL convention). Year bounds keep obvious typos out.
export function parseYearQuarter(input = {}) {
  const year = Number(input.year)
  const quarter = Number(input.quarter)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'invalid_year' }
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) return { error: 'invalid_quarter' }
  return { year, quarter }
}

export function validateReturnCreate(body = {}) {
  const period = parseYearQuarter(body)
  if (period.error) return period
  const notes = body.notes != null ? String(body.notes).trim() || null : null
  return { ...period, notes }
}

export function validatePayment(body = {}) {
  const amount = Number(body.amount_cents)
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'invalid_amount' }
  if (!isValidCalendarDate(body.paid_on)) return { error: 'invalid_date' }
  if (body.direction !== 'payment' && body.direction !== 'refund') return { error: 'invalid_direction' }
  const bankAccountCode = body.bank_account_code != null
    ? String(body.bank_account_code).trim() || null
    : null
  return {
    amount_cents: amount,
    paid_on: body.paid_on,
    direction: body.direction,
    bank_account_code: bankAccountCode,
  }
}
