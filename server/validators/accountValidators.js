const CODE_RE = /^[0-9]{4,6}$/
const CURRENCY_RE = /^[A-Z]{3}$/

export const ACCOUNT_TYPES = new Set([
  'asset', 'liability', 'equity', 'revenue', 'cost_of_goods_sold', 'expense',
])

// Maps settings field name → expected account type
export const SETTINGS_TYPE_MAP = {
  receivable_account_code: 'asset',
  primary_checking_account_code: 'asset',
  default_revenue_account_code: 'revenue',
  payable_account_code: 'liability',
  default_reimbursement_account_code: 'liability',
  default_expense_account_code: 'expense',
  output_vat_account_code: 'liability',
  input_vat_account_code: 'asset',
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

  return {
    code,
    name,
    type,
    parent_code: body.parent_code != null ? String(body.parent_code).trim() || null : null,
  }
}

export function validateCurrency(val) {
  const c = String(val ?? '').trim().toUpperCase()
  return CURRENCY_RE.test(c) ? c : null
}
