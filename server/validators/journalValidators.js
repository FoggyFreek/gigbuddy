// Pure request/parameter validation for journal routes. No DB or IO here.
import { ALLOWED_TAX_RATES } from './purchaseValidators.js'

const ALLOWED_VAT_RATES_SET = new Set(ALLOWED_TAX_RATES)
export const SIDES = new Set(['debit', 'credit'])

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string') return false
  return !Number.isNaN(Date.parse(value))
}

function snapVatRate(raw) {
  const n = Number(raw)
  return ALLOWED_VAT_RATES_SET.has(n) ? n : 0
}

// Draft normalization: permissive. Trims strings, coerces numbers, leaves
// account_code/side null when absent so a half-filled row still saves. Returns
// rows in the shape the repository inserts.
export function normalizeLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines.map((raw, idx) => {
    const code = raw.account_code != null ? String(raw.account_code).trim() : ''
    const balCode = raw.balancing_account_code != null ? String(raw.balancing_account_code).trim() : ''
    const side = raw.side != null ? String(raw.side).trim() : ''
    return {
      description: String(raw.description ?? '').trim() || null,
      account_code: code || null,
      vat_rate: snapVatRate(raw.vat_rate),
      side: SIDES.has(side) ? side : null,
      amount_cents: Number.isInteger(Number(raw.amount_cents)) && Number(raw.amount_cents) >= 0
        ? Number(raw.amount_cents) : 0,
      balancing_account_code: balCode || null,
      position: Number.isInteger(Number(raw.position)) ? Number(raw.position) : idx,
    }
  })
}

// Approve-time posting validation. Every line must be fully postable; the second
// return value (line index, 1-based) points at the first offending line.
//   activeCodes — set of account codes that exist AND are active for the tenant.
export function findUnpostableLine(lines, activeCodes) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.account_code || !activeCodes.has(l.account_code)) {
      return { index: i + 1, reason: 'account', code: 'invalid_account_code' }
    }
    if (!SIDES.has(l.side)) {
      return { index: i + 1, reason: 'side', code: 'missing_side' }
    }
    if (!(l.amount_cents > 0)) {
      return { index: i + 1, reason: 'amount', code: 'invalid_amount' }
    }
    if (l.balancing_account_code && !activeCodes.has(l.balancing_account_code)) {
      return { index: i + 1, reason: 'balancing', code: 'invalid_balancing_account' }
    }
  }
  return null
}
