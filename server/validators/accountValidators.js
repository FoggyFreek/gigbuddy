const CODE_RE = /^\d{4,6}$/
const CURRENCY_RE = /^[A-Z]{3}$/

export const ACCOUNT_TYPES = new Set([
  'asset', 'liability', 'equity', 'revenue', 'cost_of_goods_sold', 'expense',
])

// Maps settings field name → expected account type
export const SETTINGS_TYPE_MAP = {
  receivable_account_code: 'asset',
  primary_checking_account_code: 'asset',
  cash_account_code: 'asset',
  default_revenue_account_code: 'revenue',
  payable_account_code: 'liability',
  default_reimbursement_account_code: 'liability',
  default_expense_account_code: 'expense',
  output_vat_account_code: 'liability',
  input_vat_account_code: 'asset',
  vat_receivable_settlement_account_code: 'asset',
  vat_payable_settlement_account_code: 'liability',
  merch_inventory_account_code: 'asset',
  merch_revenue_account_code: 'revenue',
  merch_cogs_account_code: 'cost_of_goods_sold',
}

export const SETTINGS_CODE_FIELDS = Object.keys(SETTINGS_TYPE_MAP)

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function validateAccountCreate(body) {
  const code = String(body.code ?? '').trim()
  const name = String(body.name ?? '').trim()
  const type = body.type

  if (!CODE_RE.test(code)) return { error: 'invalid_code' }
  if (!name) return { error: 'name_required' }
  if (!ACCOUNT_TYPES.has(type)) return { error: 'invalid_type' }

  // Only asset accounts can be a capitalizable purchase target.
  const isCapitalizable = Boolean(body.is_capitalizable)
  if (isCapitalizable && type !== 'asset') return { error: 'capitalizable_requires_asset' }

  return {
    code,
    name,
    type,
    parent_code: String(body.parent_code ?? '').trim() || null,
    is_capitalizable: isCapitalizable,
  }
}

// Strict YYYY-MM-DD calendar validation: the parsed UTC date must round-trip to
// the original string, so impossible dates like 2026-02-31 are rejected (Date
// would silently roll them over to March).
export function isValidCalendarDate(val) {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return false
  const parsed = new Date(`${val}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === val
}

export function validateCurrency(val) {
  const c = String(val ?? '').trim().toUpperCase()
  return CURRENCY_RE.test(c) ? c : null
}
