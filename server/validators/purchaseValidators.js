// Pure request/parameter validation for purchase routes. No DB or IO here.
import { parsePositiveId as parseId, parseSearchLimit } from './common.js'
import { DEFAULT_VAT_COUNTRY, getVatRates, snapVatRate } from '../../shared/vatRates.js'

// The NL rate set, exported for back-compat (some tests/callers reference it).
// Country-specific rates live in shared/vatRates.js and reach the validators
// through the optional `country` parameter, defaulted to NL.
export const ALLOWED_TAX_RATES = getVatRates(DEFAULT_VAT_COUNTRY)

export const STATUS_VALUES = new Set(['draft', 'approved', 'paid'])

// Fields that make up the purchase content model. A PATCH touching any of these
// re-derives totals (when lines change) and they lock once the purchase is
// finalized. memo stays editable after finalization (mirrors invoices).
export const CONTENT_FIELDS = [
  'supplier_name',
  'supplier_contact_id',
  'receipt_date',
  'due_date',
  'currency',
  'receipt_number',
  'lines',
]
export const CONTENT_FIELDS_SET = new Set(CONTENT_FIELDS)
export const FINALIZED_LOCKED_FIELDS_SET = new Set(CONTENT_FIELDS)

// lines are replaced wholesale in purchase_lines, never a straight column SET.
export const DERIVED_CONTENT_FIELDS = new Set(['lines'])
export const SIMPLE_PATCH_FIELDS = CONTENT_FIELDS.filter((f) => !DERIVED_CONTENT_FIELDS.has(f))

export { parseId, parseSearchLimit }

// Snaps to a rate valid for the tenant's VAT country; unknown rates fall back to
// that country's standard rate.
export function snapTaxRate(raw, country = DEFAULT_VAT_COUNTRY) {
  return snapVatRate(country, raw)
}

// Returns a positive-integer receipt number, or null when the value is invalid.
export function parseReceiptNumber(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function normalizeLines(lines, country = DEFAULT_VAT_COUNTRY) {
  if (!Array.isArray(lines)) return []
  return lines.map((raw, idx) => {
    const category = String(raw.expense_category ?? '').trim()
    const code = String(raw.account_code ?? '').trim()
    const productId = parseId(raw.product_id)
    const quantity = parseId(raw.quantity)
    return {
      description: String(raw.description ?? '').trim(),
      expense_category: category || null,
      account_code: code || null,
      tax_rate: snapTaxRate(raw.tax_rate, country),
      amount_incl_cents: Number.isInteger(Number(raw.amount_incl_cents)) ? Number(raw.amount_incl_cents) : 0,
      position: Number.isInteger(Number(raw.position)) ? Number(raw.position) : idx,
      // A line that stocks a product carries which product and how many units.
      product_id: productId,
      quantity: productId ? quantity : null,
    }
  })
}

export function computeDueDate(receiptDate, days) {
  if (!receiptDate || !days) return null
  const d = new Date(receiptDate)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
