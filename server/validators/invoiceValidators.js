// Pure request/parameter validation for invoice routes. No DB or IO here.
import { parsePositiveId as parseId, parseSearchLimit, isValidIsoDate } from './common.js'
import { normalizeVatCountry, resolveVatCountry, isEuVatCountry, isValidVatId, vatIdPrefixCountry } from '../../shared/vatRates.js'
import { requiresCompanyDisclosure, registrationUsesOffice } from '../../shared/businessRegistry.js'
export { formatInvoiceNumber } from '../domain/invoice.js'

const nonEmpty = (v) => String(v ?? '').trim().length > 0

// Canonical form of a VAT number for comparison/storage: no spaces, uppercase.
export const normalizeVatNumber = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase()

// Reverse-charge due diligence: before a reverse-charge invoice may be issued the
// issuer must have confirmed they checked the customer's VAT number in VIES, and
// that confirmation must still apply to the CURRENT number (a later change to
// customer_tax_id makes a prior check stale — FR-VIES-010). We store the
// attestation rather than calling VIES ourselves. Returns an error code or null.
export function validateViesAttestation(invoice) {
  if (!invoice.vies_checked_at) return 'reverse_charge_vies_check_required'
  const attested = normalizeVatNumber(invoice.vies_checked_vat_number)
  if (!attested || attested !== normalizeVatNumber(invoice.customer_tax_id)) {
    return 'reverse_charge_vies_check_stale'
  }
  return null
}

// Issuance-readiness invariant (EU VAT Directive art. 226): an invoice may only
// be finalized (draft → sent/paid, payment-link finalization) when it holds the
// mandatory content. Runs on the EFFECTIVE persisted state under the finalizing
// transaction/lock. Returns an error code string, or null when ready.
export function validateInvoiceReadyForIssue(invoice, lines, tenant) {
  // Supplier identity + postal address.
  const supplierName = tenant.formal_name || tenant.band_name
  if (!nonEmpty(supplierName) || !nonEmpty(tenant.address_street) || !nonEmpty(tenant.address_city)) {
    return 'incomplete_supplier_details'
  }
  // Customer identity + postal address.
  if (!nonEmpty(invoice.customer_name) || !nonEmpty(invoice.customer_address_street) || !nonEmpty(invoice.customer_address_city)) {
    return 'incomplete_customer_details'
  }
  // Issue date.
  if (!invoice.issue_date || !isValidIsoDate(String(invoice.issue_date).slice(0, 10))) {
    return 'missing_issue_date'
  }
  // At least one line, each with a positive finite quantity and a description.
  if (!Array.isArray(lines) || lines.length === 0) return 'invalid_lines'
  for (const line of lines) {
    const qty = Number(line.quantity)
    if (!Number.isFinite(qty) || qty <= 0 || !nonEmpty(line.description)) return 'invalid_lines'
  }
  // Registration disclosure required of an incorporated band (GmbHG §35a etc.).
  if (requiresCompanyDisclosure(tenant.legal_form)) {
    if (!nonEmpty(tenant.kvk_number)) return 'missing_registration_info'
    if (registrationUsesOffice(tenant.vat_country) && !nonEmpty(tenant.registration_office)) {
      return 'missing_registration_info'
    }
  }
  // Supplier VAT ID when VAT is charged or the reverse charge is claimed.
  const vatCharged = Number(invoice.tax_cents) > 0
  if ((vatCharged || invoice.reverse_charge) && !nonEmpty(tenant.tax_id)) {
    return 'missing_supplier_vat_id'
  }
  // Reverse charge: a valid intra-EU customer VAT identity AND a retained VIES
  // check attestation for that exact number.
  if (invoice.reverse_charge) {
    const rcError = validateReverseCharge({
      supplierCountry: tenant.vat_country,
      customerCountry: invoice.customer_address_country,
      customerTaxId: invoice.customer_tax_id,
    })
    if (rcError) return rcError
    const viesError = validateViesAttestation(invoice)
    if (viesError) return viesError
  }
  return null
}

// Validates that an invoice actually qualifies for the intra-EU Art. 196 reverse
// charge before we zero the VAT and print the notation. A non-empty tax-id field
// is not enough: the customer must be VAT-registered in ANOTHER EU member state,
// both parties must be in the EU, and the number must match that country's VAT
// format. Returns an error code string, or null when the treatment is valid.
export function validateReverseCharge({ supplierCountry, customerCountry, customerTaxId }) {
  const taxId = String(customerTaxId ?? '').replace(/\s+/g, '').toUpperCase()
  if (!taxId) return 'customer_tax_id_required_for_reverse_charge'
  // Northern Ireland (XI) VAT numbers are in the EU VAT area for GOODS only; a
  // band's supply is a service, so an XI number must not unlock an intra-EU
  // reverse charge. Routed distinctly from GB (FR-VIES-002 / FR-GB-001).
  const prefix = vatIdPrefixCountry(taxId)
  if (prefix === 'xi') return 'reverse_charge_xi_services_unsupported'
  const supplier = normalizeVatCountry(supplierCountry)
  // The customer country is free text on the invoice (and copied from venue/gig
  // records), so accept a country name as well as a code.
  const customer = resolveVatCountry(customerCountry)
  if (!supplier || !isEuVatCountry(supplier)) return 'reverse_charge_requires_eu_supplier'
  if (!customer || !isEuVatCountry(customer)) return 'reverse_charge_requires_eu_customer'
  if (customer === supplier) return 'reverse_charge_requires_cross_border'
  // Prefix/jurisdiction consistency: a well-formed number for a DIFFERENT country
  // than the customer's is a mismatch, reported distinctly from a malformed one
  // (FR-ID-002). An unrecognized prefix falls through to the checksum failure.
  if (prefix && prefix !== customer) return 'customer_vat_number_country_mismatch'
  if (!isValidVatId(customer, taxId)) return 'invalid_customer_vat_number'
  return null
}

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
  'reverse_charge',
  'supply_date',
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

export { parseId, parseSearchLimit }

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
  const reverseCharge = Boolean(body.reverse_charge)
  const supplyDate = body.supply_date || null
  const discountType = body.discount_type === 'pct' ? 'pct' : 'eur'
  const discountPct = Math.max(0, Number(body.discount_pct) || 0)
  const discountCents = Math.max(0, Number.isInteger(Number(body.discount_cents)) ? Number(body.discount_cents) : 0)
  const lines = normalizeLines(body.lines)
  if (!lines.length) return { error: 'At least one line is required' }

  const viesChecked = Boolean(body.vies_checked)
  const viesConsultationNumber = body.vies_consultation_number != null
    ? (String(body.vies_consultation_number).trim() || null)
    : null

  // Reverse-charge eligibility depends on the supplier + customer countries
  // (which the service knows), so it is validated there via validateReverseCharge.
  return { customerName, paymentTermDays, issueDate, dueDate, taxInclusive, reverseCharge, supplyDate, discountType, discountPct, discountCents, lines, viesChecked, viesConsultationNumber }
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
