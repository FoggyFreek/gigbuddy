// Issuance-readiness rules for an invoice — the EU VAT Directive art. 226
// mandatory content, the intra-EU art. 196 reverse-charge conditions, and the
// VIES due-diligence attestation.
//
// This lives in shared/ because BOTH sides need the same answer: the backend
// enforces it (authoritatively, on the persisted state inside the finalizing
// transaction) and the frontend previews it (so "Mark as sent" can say what is
// missing instead of letting the user hit a 422). Pure — no DB, no IO.
import { normalizeVatCountry, resolveVatCountry, isEuVatCountry, isValidVatId, vatIdPrefixCountry, normalizeVatNumber } from './vatRates.js'
import { requiresCompanyDisclosure, registrationUsesOffice } from './businessRegistry.js'

// Every code these checks can return. Kept as one list so the server error
// catalogue and the frontend i18n block can be proven complete against it.
export const INVOICE_ISSUE_ERROR_CODES = Object.freeze([
  'incomplete_supplier_details',
  'incomplete_customer_details',
  'missing_issue_date',
  'invalid_lines',
  'missing_registration_info',
  'missing_supplier_vat_id',
  'customer_tax_id_required_for_reverse_charge',
  'reverse_charge_xi_services_unsupported',
  'reverse_charge_requires_eu_supplier',
  'reverse_charge_requires_eu_customer',
  'reverse_charge_requires_cross_border',
  'customer_vat_number_country_mismatch',
  'invalid_customer_vat_number',
  'reverse_charge_vies_check_required',
  'reverse_charge_vies_check_stale',
])

const nonEmpty = (v) => String(v ?? '').trim().length > 0

const isParsableDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))

// Validates that an invoice actually qualifies for the intra-EU Art. 196 reverse
// charge before we zero the VAT and print the notation. A non-empty tax-id field
// is not enough: the customer must be VAT-registered in ANOTHER EU member state,
// both parties must be in the EU, and the number must match that country's VAT
// format and checksum. Returns an error code string, or null when valid.
export function checkReverseCharge({ supplierCountry, customerCountry, customerTaxId }) {
  const taxId = normalizeVatNumber(customerTaxId)
  if (!taxId) return 'customer_tax_id_required_for_reverse_charge'
  // Northern Ireland (XI) VAT numbers are in the EU VAT area for GOODS only; a
  // band's supply is a service, so an XI number must not unlock an intra-EU
  // reverse charge. Routed distinctly from GB.
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
  // than the customer's is a mismatch, reported distinctly from a malformed one.
  // An unrecognized prefix falls through to the checksum failure.
  if (prefix && prefix !== customer) return 'customer_vat_number_country_mismatch'
  if (!isValidVatId(customer, taxId)) return 'invalid_customer_vat_number'
  return null
}

// The VAT number a STORED confirmation covers, or null when there is none.
// Callers holding a database row use this to derive `vies_confirmed_for`; the
// invoice form derives the same value from its checkbox instead, so neither side
// has to fabricate the storage shape.
export function storedViesConfirmation(row) {
  return row.vies_checked_at ? row.vies_checked_vat_number : null
}

// Reverse-charge due diligence: before a reverse-charge invoice may be issued the
// issuer must have confirmed they checked the customer's VAT number in VIES, and
// that confirmation must still apply to the CURRENT number (a later change to
// customer_tax_id makes a prior check stale). `viesConfirmedFor` is the number the
// confirmation covers. We retain the attestation rather than calling VIES
// ourselves. Returns an error code, or null.
export function checkViesAttestation({ customerTaxId, viesConfirmedFor }) {
  const confirmed = normalizeVatNumber(viesConfirmedFor)
  if (!confirmed) return 'reverse_charge_vies_check_required'
  if (confirmed !== normalizeVatNumber(customerTaxId)) return 'reverse_charge_vies_check_stale'
  return null
}

// An invoice may only be issued (draft → sent/paid, payment-link finalization)
// when it holds the mandatory content. Returns an error code, or null when ready.
//
// `regime` carries the accounting country and legal form, which live on the
// accounting profile rather than the tenant row; passing them in keeps this
// module free of storage knowledge.
export function checkInvoiceReadyForIssue(invoice, lines, tenant, regime = {}) {
  const { accountingCountry, legalForm } = regime
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
  if (!invoice.issue_date || !isParsableDate(String(invoice.issue_date).slice(0, 10))) {
    return 'missing_issue_date'
  }
  // At least one line, each with a positive finite quantity and a description.
  if (!Array.isArray(lines) || lines.length === 0) return 'invalid_lines'
  for (const line of lines) {
    const qty = Number(line.quantity)
    if (!Number.isFinite(qty) || qty <= 0 || !nonEmpty(line.description)) return 'invalid_lines'
  }
  // Registration disclosure required of an incorporated band (GmbHG §35a etc.).
  if (requiresCompanyDisclosure(legalForm)) {
    if (!nonEmpty(tenant.kvk_number)) return 'missing_registration_info'
    if (registrationUsesOffice(accountingCountry) && !nonEmpty(tenant.registration_office)) {
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
    const rcError = checkReverseCharge({
      supplierCountry: accountingCountry,
      customerCountry: invoice.customer_address_country,
      customerTaxId: invoice.customer_tax_id,
    })
    if (rcError) return rcError
    const viesError = checkViesAttestation({
      customerTaxId: invoice.customer_tax_id,
      viesConfirmedFor: invoice.vies_confirmed_for,
    })
    if (viesError) return viesError
  }
  return null
}
