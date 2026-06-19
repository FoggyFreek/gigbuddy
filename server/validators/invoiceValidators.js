// Pure request/parameter validation for invoice routes. No DB or IO here.

export const CONTENT_FIELDS = [
  'gig_id',
  'issue_date',
  'due_date',
  'payment_term_days',
  'customer_name',
  'customer_contact_title',
  'customer_contact_given_name',
  'customer_contact_family_name',
  'customer_address_street',
  'customer_address_postal_code',
  'customer_address_city',
  'customer_address_country',
  'customer_email',
  'customer_kvk',
  'customer_tax_id',
  'memo',
  'tax_inclusive',
  'discount_type',
  'discount_pct',
  'discount_cents',
  'invert_logo',
  'lines',
]
export const CONTENT_FIELDS_SET = new Set(CONTENT_FIELDS)
export const FINALIZED_LOCKED_FIELDS_SET = new Set(CONTENT_FIELDS.filter((field) => field !== 'memo'))
export const STATUS_VALUES = new Set(['draft', 'sent', 'paid', 'void'])
export const PAYMENT_TERM_DAYS = new Set([7, 14, 30, 60])

// Content fields the PATCH does NOT copy through verbatim:
//   - lines:          replaced wholesale in the invoice_lines table
//   - discount_cents: a DERIVED column — recomputeTotals writes the *effective*
//                     discount, so it's never copied from the raw request body.
// They stay in CONTENT_FIELDS (so they lock after finalization and a PATCH that
// touches them still triggers a totals recompute); they just aren't straight
// SET assignments.
export const DERIVED_CONTENT_FIELDS = new Set(['lines', 'discount_cents'])

// Columns the PATCH handler copies straight through. Derived from CONTENT_FIELDS
// (minus the derived/replaced ones) so the two lists can't drift apart.
export const SIMPLE_PATCH_FIELDS = CONTENT_FIELDS.filter((field) => !DERIVED_CONTENT_FIELDS.has(field))

// Mollie payment methods we explicitly accept; restricting up front gives a
// clearer error than a generic Mollie API error and prevents typos from
// silently being forwarded.
export const SUPPORTED_PAYMENT_METHODS = new Set([
  'applepay', 'bancontact', 'banktransfer', 'belfius', 'creditcard',
  'eps', 'ideal', 'kbc', 'paypal', 'paysafecard', 'przelewy24',
])

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Clamp a requested search result limit to a sane range (default 10, max 25).
export function parseSearchLimit(value) {
  const parsedLimit = Number.parseInt(value, 10)
  return Math.max(
    1,
    Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 10, 25),
  )
}

function pad4(n) { return String(n).padStart(4, '0') }

export function formatInvoiceNumber(year, seq) {
  return `${year}-${pad4(seq)}`
}

export function normalizeLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines.map((raw, idx) => ({
    description: String(raw.description ?? '').trim(),
    quantity: Number.isFinite(Number(raw.quantity)) ? Number(raw.quantity) : 1,
    unit_price_cents: Number.isInteger(Number(raw.unit_price_cents)) ? Number(raw.unit_price_cents) : 0,
    tax_percentage: Number.isFinite(Number(raw.tax_percentage)) ? Number(raw.tax_percentage) : 0,
    position: Number.isInteger(Number(raw.position)) ? Number(raw.position) : idx,
  }))
}

export function computeDueDate(issueDate, paymentTermDays) {
  if (!issueDate || !paymentTermDays) return null
  const d = issueDate instanceof Date ? new Date(issueDate.getTime()) : new Date(issueDate)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + paymentTermDays)
  return d.toISOString().slice(0, 10)
}

// Parses and normalizes a POST /invoices body. Pure — gig ownership is checked
// against the DB by the service. Returns { error } | normalized fields.
export function parseCreateInvoiceBody(body) {
  const customerName = String(body.customer_name ?? '').trim()
  if (!customerName) return { error: 'customer_name is required' }

  const paymentTermDays = PAYMENT_TERM_DAYS.has(Number(body.payment_term_days))
    ? Number(body.payment_term_days)
    : 14
  const issueDate = body.issue_date || new Date().toISOString().slice(0, 10)
  const dueDate = body.due_date || computeDueDate(issueDate, paymentTermDays)
  const taxInclusive = Boolean(body.tax_inclusive)
  const discountType = body.discount_type === 'pct' ? 'pct' : 'eur'
  const discountPct = Math.max(0, Number(body.discount_pct) || 0)
  const discountCents = Math.max(0, Number.isInteger(Number(body.discount_cents)) ? Number(body.discount_cents) : 0)
  const lines = normalizeLines(body.lines)
  if (!lines.length) return { error: 'At least one line is required' }

  return { customerName, paymentTermDays, issueDate, dueDate, taxInclusive, discountType, discountPct, discountCents, lines }
}

function validateExpiresAt(value) {
  if (value === undefined || value === null) return { ok: true }
  if (typeof value !== 'string') return { error: 'invalid_expires_at' }
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return { error: 'invalid_expires_at' }
  if (ts <= Date.now()) return { error: 'expires_at_in_past' }
  return { ok: true, value }
}

function validateAllowedMethods(value) {
  if (value === undefined || value === null) return { ok: true }
  if (!Array.isArray(value)) return { error: 'invalid_allowed_methods' }
  if (!value.length) return { ok: true }
  for (const m of value) {
    if (typeof m !== 'string' || !SUPPORTED_PAYMENT_METHODS.has(m)) {
      return { error: 'unsupported_payment_method' }
    }
  }
  return { ok: true, value }
}

export function validatePaymentLinkOptions(body) {
  const expires = validateExpiresAt(body.expiresAt)
  if (expires.error) return { error: expires.error }
  const methods = validateAllowedMethods(body.allowedMethods)
  if (methods.error) return { error: methods.error }
  return { expiresAt: expires.value, allowedMethods: methods.value }
}
