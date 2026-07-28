// Renders an invoice as a UBL 2.1 Invoice conforming to EN 16931 and shaped for
// Peppol BIS Billing 3.0 — the machine-readable counterpart to the PDF that
// renderInvoicePdf.js produces. Pure: no DB, no IO.
//
// Scope is what GigBuddy actually issues: commercial invoices (type 380), in
// EUR, from the ten supported VAT countries, with an optional document-level
// discount. No credit notes, no charges, no prepayments, no foreign currency.
//
// The electronic addresses are DERIVED from VAT and registration numbers (see
// shared/peppol.js). Holding a VAT number does not prove the party registered it
// as a Peppol participant, so callers surface that caveat via
// shared/peppolReadiness.js rather than claiming the file is routable.
//
// VALIDATION — read this before changing the output.
//
// Changing this file breaks the byte-compared goldens in src/tests/fixtures/ubl/.
// Regenerate them with `npm run build:ubl-goldens`, which renders every case,
// checks it against BOTH official rulesets (EN 16931 CEN and Peppol BIS 3.0) and
// refuses to write anything that fails. That is the gate — a non-conformant
// document cannot quietly become the new expected output.
//
// One-time setup: `npm run build:schematron` compiles the vendored Schematrons
// (external/schematron/) into runnable form.
//
// Prefer adding a case to src/tests/renderInvoiceUblSchematron.test.js over
// transcribing a rule into a hand-written assertion. Both defects found so far —
// UBL-SR-53 and UBL-CR-481 — passed the entire structural suite and were caught
// only by the real ruleset.
//
// Pick the artefact deliberately. National CIUSes (Italy's AGID-EN16931-UBL,
// Germany's XRechnung) are SEPARATE specifications with their own
// CustomizationID; validating this document against one reports BR-IT-*/BR-DE-*
// rules it never claimed to follow. Those failures are not defects.
import { computeVatBreakdown } from './computeInvoiceTotals.js'
import { resolveInvoiceLng, getInvoiceT } from './invoiceI18n.js'
import { normalizeIban } from './normalizeIban.js'
import { korApplies, resolveVatCountry, vatIdPrefixCountry } from '../../shared/vatRates.js'
import {
  EAS_NL_KVK,
  deriveEndpointId,
  money,
  numeric,
  quantity,
  resolvePostalCountry,
  toUblDate,
  unitPriceAmount,
} from '../../shared/peppol.js'

const CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'
const PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'
const COMMERCIAL_INVOICE = '380'
const CREDIT_TRANSFER = '30'
const DISCOUNT_REASON_CODE = '95' // UNCL5189 "Discount"
const UNIT_ONE = 'C62' // UN/ECE Rec 20 — the unit for a service with no measure
const CURRENCY = 'EUR'

// ---------------------------------------------------------------------------
// Serialization
//
// PEPPOL-EN16931-R008 rejects a document containing ANY empty element, so these
// two builders make an empty node unrepresentable rather than something to
// remember to guard: leaf() collapses to null when it has no text, and el()
// drops null children (and is itself dropped when nothing survives).
// ---------------------------------------------------------------------------

function leaf(name, text, attrs) {
  if (text === null || text === undefined) return null
  const value = String(text)
  return value.trim() === '' ? null : { name, attrs, text: value }
}

function el(name, attrs, children) {
  const kept = (children ?? []).filter(Boolean)
  return kept.length > 0 ? { name, attrs, children: kept } : null
}

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

function serialize(node, indent = '  ') {
  const attrs = Object.entries(node.attrs ?? {})
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('')
  if (node.children) {
    const inner = node.children.map((child) => serialize(child, `${indent}  `)).join('\n')
    return `${indent}<${node.name}${attrs}>\n${inner}\n${indent}</${node.name}>`
  }
  return `${indent}<${node.name}${attrs}>${escapeXml(node.text)}</${node.name}>`
}

const amount = (name, cents) => leaf(name, money(cents), { currencyID: CURRENCY })

// ---------------------------------------------------------------------------
// Document fragments
// ---------------------------------------------------------------------------

const taxScheme = () => el('cac:TaxScheme', null, [leaf('cbc:ID', 'VAT')])

// BT-118/BT-119. `reasons` is populated ONLY for the VAT breakdown — an
// exemption reason on an allowance's TaxCategory trips UBL-CR-481, and the
// line-level ClassifiedTaxCategory has never carried one either.
function taxCategory(category, reasons = []) {
  return el('cac:TaxCategory', null, [
    leaf('cbc:ID', category.code),
    leaf('cbc:Percent', numeric(category.percent)),
    ...reasons,
    taxScheme(),
  ])
}

// Only AE and E state a reason: BR-Z-10 and BR-S-10 forbid one on zero-rated and
// standard-rated breakdowns. AE additionally gets the VATEX code; the Dutch KOR
// has no unambiguous VATEX equivalent and picking the wrong one would trip
// PEPPOL-EN16931-P0104..P0111, so it carries free text alone (BR-E-10 allows it).
function exemptionReasons(category, t) {
  if (category.code === 'AE') {
    return [
      leaf('cbc:TaxExemptionReasonCode', 'VATEX-EU-AE'),
      leaf('cbc:TaxExemptionReason', t('reverseChargeNote')),
    ]
  }
  if (category.code === 'E') return [leaf('cbc:TaxExemptionReason', t('korNote'))]
  return []
}

function postalAddress(street, postalCode, city, countryCode) {
  return el('cac:PostalAddress', null, [
    leaf('cbc:StreetName', street),
    leaf('cbc:CityName', city),
    leaf('cbc:PostalZone', postalCode),
    el('cac:Country', null, [leaf('cbc:IdentificationCode', countryCode)]),
  ])
}

// The whole group exists to carry the VAT identifier, so it stands or falls with
// it: UBL-SR-53 rejects a PartyTaxScheme that states a TaxScheme/ID without a
// CompanyID. el() alone will not catch this — TaxScheme is a constant, so the
// group is never *fully* empty and would survive as a bare shell.
function partyTaxScheme(vatNumber) {
  const companyId = leaf('cbc:CompanyID', vatNumber)
  return companyId ? el('cac:PartyTaxScheme', null, [companyId, taxScheme()]) : null
}

function endpointId(endpoint) {
  return endpoint ? leaf('cbc:EndpointID', endpoint.value, { schemeID: endpoint.schemeId }) : null
}

function supplierParty(tenant, ctx) {
  const legalName = tenant.formal_name || tenant.band_name
  // schemeID 0106 asserts the number IS a KVK registration, which is a fact
  // about the tax jurisdiction, not the postal address. When the two disagree
  // we omit CompanyID entirely: NL-R-003 only fires on an element that exists,
  // so omitting is safe, whereas mislabelling a foreign register number is not.
  const companyId = ctx.sellerVatCountry === 'nl'
    ? leaf('cbc:CompanyID', tenant.kvk_number, { schemeID: EAS_NL_KVK })
    : null

  return el('cac:AccountingSupplierParty', null, [
    el('cac:Party', null, [
      endpointId(ctx.sellerEndpoint),
      // Trading name, only when it differs from the registered name.
      tenant.band_name && tenant.band_name !== legalName
        ? el('cac:PartyName', null, [leaf('cbc:Name', tenant.band_name)])
        : null,
      postalAddress(tenant.address_street, tenant.address_postal_code, tenant.address_city, ctx.sellerCountry),
      partyTaxScheme(tenant.tax_id),
      el('cac:PartyLegalEntity', null, [leaf('cbc:RegistrationName', legalName), companyId]),
      sellerContact(tenant, legalName),
    ]),
  ])
}

// BG-6, optional in EN 16931 but mandatory for a domestic German invoice
// (DE-R-002/005/006/007 require the group plus name, telephone AND email).
//
// Emitted only when there is a telephone or email to state: a contact group
// carrying nothing but a name repeats PartyLegalEntity and says nothing. BT-41
// has no field of its own, so it reuses the registered name — the same thing the
// real-world e-fff reference invoice does.
function sellerContact(tenant, legalName) {
  const details = [
    leaf('cbc:Telephone', tenant.phone),
    leaf('cbc:ElectronicMail', tenant.email),
  ].filter(Boolean)
  if (details.length === 0) return null
  return el('cac:Contact', null, [leaf('cbc:Name', legalName), ...details])
}

function customerParty(invoice, ctx) {
  const contactName = [
    invoice.customer_contact_title,
    invoice.customer_contact_given_name,
    invoice.customer_contact_family_name,
  ].filter((part) => String(part ?? '').trim()).join(' ')

  // NL-R-005 demands 0106/0190 on a buyer CompanyID, but only when both parties
  // are Dutch; elsewhere the number is emitted unqualified.
  const bothDutch = ctx.sellerCountry === 'NL' && ctx.buyerCountry === 'NL'
  const companyId = bothDutch
    ? leaf('cbc:CompanyID', invoice.customer_kvk, { schemeID: EAS_NL_KVK })
    : leaf('cbc:CompanyID', invoice.customer_kvk)

  return el('cac:AccountingCustomerParty', null, [
    el('cac:Party', null, [
      endpointId(ctx.buyerEndpoint),
      postalAddress(
        invoice.customer_address_street,
        invoice.customer_address_postal_code,
        invoice.customer_address_city,
        ctx.buyerCountry,
      ),
      partyTaxScheme(invoice.customer_tax_id),
      el('cac:PartyLegalEntity', null, [
        leaf('cbc:RegistrationName', invoice.customer_name),
        companyId,
      ]),
      el('cac:Contact', null, [
        leaf('cbc:Name', contactName),
        leaf('cbc:ElectronicMail', invoice.customer_email),
      ]),
    ]),
  ])
}

function paymentMeans(invoice, tenant) {
  const iban = tenant.iban ? normalizeIban(tenant.iban) : null
  if (!iban) return null
  return el('cac:PaymentMeans', null, [
    leaf('cbc:PaymentMeansCode', CREDIT_TRANSFER),
    leaf('cbc:PaymentID', invoice.invoice_number),
    el('cac:PayeeFinancialAccount', null, [
      leaf('cbc:ID', iban),
      leaf('cbc:Name', tenant.formal_name || tenant.band_name),
      // No FinancialInstitutionBranch — there is no BIC column. BT-86 is
      // optional and an IBAN alone is sufficient within SEPA.
    ]),
  ])
}

// One allowance per VAT category. BR-32/BR-33 make the category mandatory on a
// document-level allowance, so a single node can only ever describe one rate;
// BR-S-08 then reconciles each category's taxable base separately.
//
// MultiplierFactorNumeric/BaseAmount are deliberately omitted even for a
// percentage discount: R041/R042 make them an all-or-nothing pair and R040 then
// demands Amount = BaseAmount x pct/100, which the proportional per-category
// allocation does not satisfy. The plain Amount is complete on its own.
function allowances(categories, t) {
  return categories
    .filter((category) => category.allowanceCents > 0)
    .map((category) => el('cac:AllowanceCharge', null, [
      leaf('cbc:ChargeIndicator', 'false'),
      leaf('cbc:AllowanceChargeReasonCode', DISCOUNT_REASON_CODE),
      leaf('cbc:AllowanceChargeReason', t('discount')),
      amount('cbc:Amount', category.allowanceCents),
      taxCategory(category),
    ]))
}

// Exactly one TaxTotal carrying subtotals (PEPPOL-EN16931-R053), with a subtotal
// for EVERY category — including zero-tax ones, which computeInvoiceTotals'
// vatByRate drops but BR-Z-08/BR-E-08/BR-AE-08 require.
function taxTotal(totals, categories, t) {
  return el('cac:TaxTotal', null, [
    amount('cbc:TaxAmount', totals.taxCents),
    ...categories.map((category) => el('cac:TaxSubtotal', null, [
      amount('cbc:TaxableAmount', category.taxableCents),
      amount('cbc:TaxAmount', category.taxCents),
      taxCategory(category, exemptionReasons(category, t)),
    ])),
  ])
}

function legalMonetaryTotal(totals) {
  const taxExclusive = totals.subtotalCents - totals.discountCents
  return el('cac:LegalMonetaryTotal', null, [
    amount('cbc:LineExtensionAmount', totals.subtotalCents),
    amount('cbc:TaxExclusiveAmount', taxExclusive),
    amount('cbc:TaxInclusiveAmount', taxExclusive + totals.taxCents),
    totals.discountCents > 0 ? amount('cbc:AllowanceTotalAmount', totals.discountCents) : null,
    amount('cbc:PayableAmount', totals.totalCents),
  ])
}

function invoiceLines(lines, totals, categoryByRate, zeroVat) {
  return lines.map((line, index) => {
    const netCents = totals.perLine[index].netCents
    const rate = zeroVat ? 0 : Number(line.tax_percentage) || 0
    const category = categoryByRate.get(rate)
    return el('cac:InvoiceLine', null, [
      // A 1-based sequence, not `position`: that starts at 0 and may repeat,
      // while BR-21 requires a unique line identifier.
      leaf('cbc:ID', String(index + 1)),
      leaf('cbc:InvoicedQuantity', quantity(line.quantity), { unitCode: UNIT_ONE }),
      amount('cbc:LineExtensionAmount', netCents),
      el('cac:Item', null, [
        leaf('cbc:Name', line.description),
        // No exemption reason at line level — that belongs to the breakdown.
        el('cac:ClassifiedTaxCategory', null, [
          leaf('cbc:ID', category.code),
          leaf('cbc:Percent', numeric(category.percent)),
          taxScheme(),
        ]),
      ]),
      el('cac:Price', null, [
        leaf('cbc:PriceAmount', unitPriceAmount(netCents, line.quantity), { currencyID: CURRENCY }),
        // BaseQuantity omitted: it defaults to 1, and leaving it out keeps
        // R121/R130 (unit-code agreement) inert.
      ]),
    ])
  })
}

// ---------------------------------------------------------------------------

export function renderInvoiceUbl({ invoice, lines, tenant }) {
  const appliesKor = Boolean(tenant.applies_kor) && korApplies(tenant.vat_country)
  const reverseCharge = Boolean(invoice.reverse_charge)
  const zeroVat = appliesKor || reverseCharge

  const { totals, categories } = computeVatBreakdown({
    lines,
    taxInclusive: invoice.tax_inclusive,
    discountCents: invoice.discount_cents,
    discountType: invoice.discount_type,
    discountPct: invoice.discount_pct,
    appliesKor,
    reverseCharge,
  })
  const categoryByRate = new Map(categories.map((category) => [category.percent, category]))

  const t = getInvoiceT(resolveInvoiceLng(tenant.vat_country))

  // Postal country selects the national rule set; the tax jurisdiction supplies
  // the identifiers. They are separate facts and may legitimately differ.
  const ctx = {
    sellerCountry: resolvePostalCountry(tenant.address_country),
    buyerCountry: resolvePostalCountry(invoice.customer_address_country),
    sellerVatCountry: tenant.vat_country,
    sellerEndpoint: deriveEndpointId({
      country: tenant.vat_country,
      vatId: tenant.tax_id,
      kvk: tenant.kvk_number,
    }),
    buyerEndpoint: deriveEndpointId({
      country: vatIdPrefixCountry(invoice.customer_tax_id)
        ?? resolveVatCountry(invoice.customer_address_country),
      vatId: invoice.customer_tax_id,
      kvk: invoice.customer_kvk,
    }),
  }

  // BT-10. PEPPOL-EN16931-R003 requires this or an OrderReference, and GigBuddy
  // has no buyer-reference field — the gig name is what the customer booked and
  // will recognise. Falling back to our own invoice number is reported as an
  // advisory warning, since some AP systems match on their own order number.
  const buyerReference = String(invoice.event_description ?? '').trim() || invoice.invoice_number

  const root = el('Invoice', {
    'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  }, [
    leaf('cbc:CustomizationID', CUSTOMIZATION_ID),
    leaf('cbc:ProfileID', PROFILE_ID),
    leaf('cbc:ID', invoice.invoice_number),
    leaf('cbc:IssueDate', toUblDate(invoice.issue_date)),
    leaf('cbc:DueDate', toUblDate(invoice.due_date)),
    leaf('cbc:InvoiceTypeCode', COMMERCIAL_INVOICE),
    // At most one document note (PEPPOL-EN16931-R002).
    leaf('cbc:Note', invoice.memo),
    leaf('cbc:DocumentCurrencyCode', CURRENCY),
    leaf('cbc:BuyerReference', buyerReference),
    supplierParty(tenant, ctx),
    customerParty(invoice, ctx),
    // Date of supply (BT-72). Not TaxPointDate: BR-CO-3 makes the two mutually
    // exclusive and Peppol discourages BT-7.
    el('cac:Delivery', null, [leaf('cbc:ActualDeliveryDate', toUblDate(invoice.supply_date))]),
    paymentMeans(invoice, tenant),
    invoice.payment_term_days
      ? el('cac:PaymentTerms', null, [
        leaf('cbc:Note', t('paymentTerm', { count: invoice.payment_term_days })),
      ])
      : null,
    ...allowances(categories, t),
    taxTotal(totals, categories, t),
    legalMonetaryTotal(totals),
    ...invoiceLines(lines, totals, categoryByRate, zeroVat),
  ])

  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(root, '')}\n`
}
