import { parsePositiveId as parseId } from '../../validators/common.js'
import { isValidCalendarDate } from '../accounts/accountValidators.js'

export { parseId }

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
  const notes = String(body.notes ?? '').trim() || null
  const calculationMode = body.calculation_mode === 'category_workpaper'
    ? 'category_workpaper'
    : 'legacy_generic'
  return { ...period, notes, calculationMode }
}

export function validateSubmission(body = {}) {
  const submissionReference = String(body.submission_reference ?? '').trim()
  if (!submissionReference) {
    return {
      error: 'Submission reference is required',
      code: 'submission_reference_required',
    }
  }
  if (submissionReference.length > 200) {
    return {
      error: 'Submission reference must not exceed 200 characters',
      code: 'submission_reference_too_long',
    }
  }
  return { submissionReference }
}

export function validateExceptionAcknowledgement(body = {}) {
  const exceptionKey = String(body.exception_key ?? '').trim()
  const note = String(body.note ?? '').trim()
  if (!exceptionKey) return { error: 'exception_key_required' }
  if (!note) return { error: 'acknowledgement_note_required' }
  return { exceptionKey, note }
}

export function validatePayment(body = {}) {
  const amount = Number(body.amount_cents)
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'invalid_amount' }
  if (!isValidCalendarDate(body.paid_on)) return { error: 'invalid_date' }
  if (body.direction !== 'payment' && body.direction !== 'refund') return { error: 'invalid_direction' }
  const bankAccountCode = String(body.bank_account_code ?? '').trim() || null
  return {
    amount_cents: amount,
    paid_on: body.paid_on,
    direction: body.direction,
    bank_account_code: bankAccountCode,
  }
}
