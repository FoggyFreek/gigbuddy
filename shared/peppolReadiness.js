// Whether an invoice's UBL rendering would survive Peppol validation.
//
// This lives in shared/ for the same reason invoiceReadiness.js does: BOTH
// sides need the same answer. The backend reports it alongside the generated
// file, and the frontend previews it so the user learns *before* downloading
// that a receiver will bounce the document.
//
// Unlike checkInvoiceReadyForIssue this NEVER blocks anything — the XML always
// downloads. A 'blocking' severity means "a Peppol access point will reject
// this", not "we refuse to produce it".
//
// Pure — no DB, no IO.
import { resolvePostalCountry, deriveEndpointId } from './peppol.js'
import { computeVatBreakdown } from './invoiceTotals.js'
import { resolveVatCountry, vatIdPrefixCountry } from './vatRates.js'

// Every code these checks can return, in report order. Kept as one list so the
// i18n bundles can be proven complete against it.
export const PEPPOL_WARNING_CODES = Object.freeze([
  // Blocking — the document is not routable or not valid.
  'missing_seller_endpoint',
  'missing_buyer_endpoint',
  'unknown_seller_country',
  'unknown_buyer_country',
  'missing_seller_postal_code',
  'missing_buyer_postal_code',
  'missing_payment_account',
  'de_domestic_contact_required',
  'line_missing_name',
  'vat_rounding_drift',
  // Advisory — valid, but the user should know.
  'endpoint_inferred',
  'missing_buyer_vat_id',
  'buyer_reference_defaulted',
])

const BLOCKING = new Set([
  'missing_seller_endpoint', 'missing_buyer_endpoint',
  'unknown_seller_country', 'unknown_buyer_country',
  'missing_seller_postal_code', 'missing_buyer_postal_code',
  'missing_payment_account', 'de_domestic_contact_required',
  'line_missing_name',
])

const nonEmpty = (v) => String(v ?? '').trim().length > 0

// A category's tax may legitimately differ by a cent or two from
// taxableAmount x rate, because computeInvoiceTotals sums per-line VAT to keep
// gross = net + tax exact on tax-inclusive invoices. BR-S-09 / BR-CO-17 tolerate
// under one whole currency unit, so only a gap that reaches EUR 1 is fatal.
const DRIFT_FATAL_CENTS = 100

// `treatment` is the resolved VAT treatment (see server/services/vatTreatmentService).
// This module stays pure — the caller passes it in — so readiness and the
// renderers can never disagree about whether VAT was suppressed.
export function checkPeppolReadiness({ invoice, lines, tenant, treatment }) {
  const found = new Set()
  const add = (code) => found.add(code)

  // Postal countries decide which national rule set applies — the Schematron
  // keys NL-R-* and DE-R-* on the address country, not the tax jurisdiction.
  const sellerCountry = resolvePostalCountry(tenant.address_country)
  const buyerCountry = resolvePostalCountry(invoice.customer_address_country)
  if (!sellerCountry) add('unknown_seller_country')
  if (!buyerCountry) add('unknown_buyer_country')

  // Electronic addresses come from the TAX jurisdiction instead: the scheme
  // states which register the identifier belongs to.
  const sellerVatCountry = treatment?.accounting_country
  const sellerEndpoint = deriveEndpointId({
    country: sellerVatCountry,
    vatId: tenant.tax_id,
    kvk: tenant.kvk_number,
  })
  const buyerTaxCountry = vatIdPrefixCountry(invoice.customer_tax_id)
    ?? resolveVatCountry(invoice.customer_address_country)
  const buyerEndpoint = deriveEndpointId({
    country: buyerTaxCountry,
    vatId: invoice.customer_tax_id,
    kvk: invoice.customer_kvk,
  })
  if (!sellerEndpoint) add('missing_seller_endpoint')
  if (!buyerEndpoint) add('missing_buyer_endpoint')
  if (sellerEndpoint || buyerEndpoint) add('endpoint_inferred')
  if (!nonEmpty(invoice.customer_tax_id)) add('missing_buyer_vat_id')

  const dutchSupplier = sellerCountry === 'NL'
  const germanDomestic = sellerCountry === 'DE' && buyerCountry === 'DE'

  // NL-R-002 / DE-R-004 (seller), NL-R-004 / DE-R-009 (buyer).
  if ((dutchSupplier || germanDomestic) && !nonEmpty(tenant.address_postal_code)) {
    add('missing_seller_postal_code')
  }
  const buyerPostcodeRequired = (dutchSupplier && buyerCountry === 'NL') || germanDomestic
  if (buyerPostcodeRequired && !nonEmpty(invoice.customer_address_postal_code)) {
    add('missing_buyer_postal_code')
  }

  // NL-R-007 contexts on the supplier country alone, so it applies to a Dutch
  // supplier billing anywhere. DE-R-001 is domestic-only. Both need something
  // payable; BR-61 then makes the account mandatory for a credit transfer.
  const payable = Number(invoice.total_cents) || 0
  if ((dutchSupplier || germanDomestic) && payable > 0 && !nonEmpty(tenant.iban)) {
    add('missing_payment_account')
  }

  // DE-R-002/005/006/007 require a seller contact group with name, telephone
  // AND email. The name reuses the registered name, so only the two contact
  // fields can actually be missing.
  if (germanDomestic && !(nonEmpty(tenant.email) && nonEmpty(tenant.phone))) {
    add('de_domestic_contact_required')
  }

  // BR-25: every line needs an item name.
  if (Array.isArray(lines) && lines.some((line) => !nonEmpty(line.description))) {
    add('line_missing_name')
  }

  // BR-31 / DE-R-015: we substitute the gig name for the missing buyer
  // reference, and fall back to the invoice number when there is no gig.
  if (!nonEmpty(invoice.event_description)) add('buyer_reference_defaulted')

  if (hasFatalVatDrift({ invoice, lines, treatment })) add('vat_rounding_drift')

  return PEPPOL_WARNING_CODES
    .filter((code) => found.has(code))
    .map((code) => ({ code, severity: BLOCKING.has(code) ? 'blocking' : 'advisory' }))
    .sort((a, b) => Number(b.severity === 'blocking') - Number(a.severity === 'blocking'))
}

function hasFatalVatDrift({ invoice, lines, treatment }) {
  if (!Array.isArray(lines) || lines.length === 0) return false
  const { categories } = computeVatBreakdown({
    lines,
    taxInclusive: invoice.tax_inclusive,
    discountCents: invoice.discount_cents,
    discountType: invoice.discount_type,
    discountPct: invoice.discount_pct,
    appliesKor: Boolean(treatment?.schemeExempt),
    reverseCharge: invoice.reverse_charge,
  })
  return categories.some((c) => {
    const expected = Math.round((c.taxableCents * c.percent) / 100)
    return Math.abs(c.taxCents - expected) >= DRIFT_FATAL_CENTS
  })
}

// True when nothing would make a Peppol access point reject the document.
export function isPeppolReady(warnings) {
  return !warnings.some((w) => w.severity === 'blocking')
}
