// Pure request/parameter validation for purchase routes. No DB or IO here.

export const ALLOWED_TAX_RATES = [21, 9, 0]
const ALLOWED_TAX_RATES_SET = new Set(ALLOWED_TAX_RATES)

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

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function snapTaxRate(raw) {
  const n = Number(raw)
  return ALLOWED_TAX_RATES_SET.has(n) ? n : 21
}

// Returns a positive-integer receipt number, or null when the value is invalid.
export function parseReceiptNumber(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function normalizeLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines.map((raw, idx) => {
    const category = String(raw.expense_category ?? '').trim()
    return {
      description: String(raw.description ?? '').trim(),
      expense_category: category || null,
      tax_rate: snapTaxRate(raw.tax_rate),
      amount_incl_cents: Number.isInteger(Number(raw.amount_incl_cents)) ? Number(raw.amount_incl_cents) : 0,
      position: Number.isInteger(Number(raw.position)) ? Number(raw.position) : idx,
    }
  })
}

export function computeDueDate(receiptDate, days) {
  if (!receiptDate || !days) return null
  const d = receiptDate instanceof Date ? new Date(receiptDate.getTime()) : new Date(receiptDate)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
