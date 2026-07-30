// Invoice/tenant fixtures for the UBL renderer, shared by the test and the
// golden-file generator so the two can never drift.
const NL_TENANT = {
  formal_name: 'The Woods BV',
  band_name: 'The Woods',
  address_street: 'Middelhorsterweg 32',
  address_postal_code: '9751TG',
  address_city: 'Haren',
  address_country: 'Netherlands',
  vat_country: 'nl',
  tax_id: 'NL819789471B01',
  kvk_number: '12345678',
  iban: 'NL91 ABNA 0417 1643 00',
  applies_kor: false,
}

const BASE_INVOICE = {
  invoice_number: '2026-0007',
  issue_date: '2026-07-28',
  due_date: '2026-08-11',
  supply_date: '2026-07-20',
  payment_term_days: 14,
  memo: 'Thanks for having us.',
  customer_name: 'Jerboa BV',
  customer_contact_given_name: 'Frank',
  customer_contact_family_name: 'De Vries',
  customer_address_street: 'Molendreef 67',
  customer_address_postal_code: '9920',
  customer_address_city: 'Lievegem',
  customer_address_country: 'BE',
  customer_email: 'fd@jerboa.example',
  customer_tax_id: 'BE0779341748',
  customer_kvk: null,
  event_description: 'One Shot — Our Love',
  tax_inclusive: false,
  reverse_charge: false,
  discount_type: 'eur',
  discount_cents: 0,
  discount_pct: 0,
}

const RAW_CASES = {
  'nl-standard': {
    tenant: NL_TENANT,
    invoice: {
      ...BASE_INVOICE,
      customer_address_country: 'NL',
      customer_address_postal_code: '1011AB',
      customer_address_city: 'Amsterdam',
      customer_tax_id: 'NL819789471B01',
      customer_kvk: '87654321',
    },
    lines: [{ description: 'Live performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 21 }],
  },
  'multi-rate-discount': {
    tenant: NL_TENANT,
    invoice: { ...BASE_INVOICE, discount_type: 'pct', discount_pct: 10 },
    lines: [
      { description: 'Live performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 21 },
      { description: 'Merchandise', quantity: 3, unit_price_cents: 2500, tax_percentage: 9 },
    ],
  },
  'reverse-charge': {
    tenant: NL_TENANT,
    invoice: { ...BASE_INVOICE, reverse_charge: true },
    lines: [{ description: 'Live performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 21 }],
  },
  kor: {
    tenant: { ...NL_TENANT, applies_kor: true },
    invoice: { ...BASE_INVOICE, customer_address_country: 'NL', customer_address_postal_code: '1011AB', customer_tax_id: 'NL819789471B01' },
    lines: [{ description: 'Live performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 21 }],
  },
  'be-supplier': {
    tenant: {
      ...NL_TENANT,
      formal_name: 'Jerboa BV',
      band_name: 'Jerboa',
      address_street: 'Molendreef 67',
      address_postal_code: '9920',
      address_city: 'Lievegem',
      address_country: 'Belgium',
      vat_country: 'be',
      tax_id: 'BE0779341748',
      kvk_number: null,
      iban: 'BE13737058655539',
    },
    invoice: {
      ...BASE_INVOICE,
      customer_address_country: 'Netherlands',
      customer_address_postal_code: '9751TG',
      customer_address_city: 'Haren',
      customer_tax_id: 'NL819789471B01',
    },
    lines: [{ description: 'Mastering', quantity: 1, unit_price_cents: 15000, tax_percentage: 21 }],
  },
  // The everyday case: a small venue with no VAT number. Nothing identifies the
  // buyer, so both the EndpointID and the whole PartyTaxScheme group drop out.
  // Kept as a golden because every other fixture has VAT numbers on both sides
  // and so never exercised the omission paths.
  'no-buyer-vat': {
    tenant: NL_TENANT,
    invoice: {
      ...BASE_INVOICE,
      customer_address_country: 'NL',
      customer_address_postal_code: '1011AB',
      customer_address_city: 'Amsterdam',
      customer_tax_id: null,
      customer_kvk: null,
    },
    lines: [{ description: 'Live performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 21 }],
  },
  // An exempt category that also carries a discount. Kept as a golden because
  // the combination is where UBL-CR-481 bit: the allowance's TaxCategory must
  // NOT repeat the exemption reason that the VAT breakdown states.
  'kor-discount': {
    tenant: { ...NL_TENANT, applies_kor: true },
    invoice: {
      ...BASE_INVOICE,
      customer_address_country: 'NL',
      customer_address_postal_code: '1011AB',
      customer_address_city: 'Amsterdam',
      customer_tax_id: 'NL819789471B01',
      discount_type: 'pct',
      discount_pct: 15,
    },
    lines: [{ description: 'Live performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 21 }],
  },
  // A band that is on the KOR TODAY, but whose historical invoice charged VAT.
  // Migration 141 snapshots it as `standard`, because the document's own totals
  // (and the output VAT the ledger posted from them) prove what it was issued
  // as — the current scheme flag does not. Before this step the renderer read
  // that live flag and zeroed the VAT, i.e. printed something the invoice never
  // was; this golden pins the corrected behavior so it cannot regress back.
  'kor-tenant-historical-vat': {
    tenant: { ...NL_TENANT, applies_kor: true },
    treatment: {
      accounting_country: 'nl',
      vat_scheme_code: 'nl_kor',
      vat_treatment: 'standard',
      schemeExempt: false,
      chargesOutputVat: true,
      inputVatRecoverable: false,
      vat_treatment_version: 1,
    },
    invoice: {
      ...BASE_INVOICE,
      customer_address_country: 'NL',
      customer_address_postal_code: '1011AB',
      customer_address_city: 'Amsterdam',
      customer_tax_id: 'NL819789471B01',
    },
    lines: [{ description: 'Live performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 21 }],
  },
  // Domestic German
  'de-domestic': {
    tenant: {
      ...NL_TENANT,
      formal_name: 'Die Wälder GmbH',
      band_name: 'Die Wälder',
      address_street: 'Torstraße 12',
      address_postal_code: '10119',
      address_city: 'Berlin',
      address_country: 'Germany',
      vat_country: 'de',
      tax_id: 'DE136695976',
      kvk_number: null,
      iban: 'DE89370400440532013000',
      email: 'buchung@diewaelder.example',
      phone: '+49 30 1234567',
    },
    invoice: {
      ...BASE_INVOICE,
      customer_name: 'Konzerthaus GmbH',
      customer_address_street: 'Gendarmenmarkt 2',
      customer_address_postal_code: '10117',
      customer_address_city: 'Berlin',
      customer_address_country: 'Germany',
      customer_tax_id: 'DE136695976',
    },
    lines: [{ description: 'Live performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 19 }],
  },
}

// The VAT treatment the renderer now takes as an input instead of deriving from
// live tenant state. Derived here ONE-TO-ONE from what the fixtures' tenant flags
// used to mean — `applies_kor` gated to NL, exactly what korApplies() did — so
// every golden stays byte-identical and the regeneration diff proves it.
//
// Note reverse charge is NOT folded in: it is the invoice's own column and the
// renderer still reads it there, which is why a case can override it in a spread
// and still get the right document.
function treatmentFor(tenant) {
  const schemeExempt = Boolean(tenant.applies_kor) && tenant.vat_country === 'nl'
  return {
    accounting_country: tenant.vat_country,
    vat_scheme_code: schemeExempt ? 'nl_kor' : null,
    vat_treatment: schemeExempt ? 'small_business_exempt' : 'standard',
    schemeExempt,
    chargesOutputVat: !schemeExempt,
    inputVatRecoverable: !schemeExempt,
    vat_treatment_version: 1,
  }
}

// A case may state its own treatment where the tenant flags cannot express it —
// which is precisely the situation migration 141's evidence-first backfill
// produces.
const CASES = Object.fromEntries(
  Object.entries(RAW_CASES).map(([name, input]) => [
    name,
    { ...input, treatment: input.treatment ?? treatmentFor(input.tenant) },
  ]),
)

// Peppol adds network-addressing rules on top of EN 16931, and we deliberately
// still emit documents that break some of them rather than refusing the
// download. Declaring them here means an UNDECLARED failure is a defect — both
// the conformance suite and the golden builder hold the output to this.
const EXPECTED_PEPPOL_FAILURES = {
  // No VAT or Chamber of Commerce number, so no buyer electronic address (BT-49)
  // can be derived. Surfaced to the user as the blocking `missing_buyer_endpoint`
  // warning — valid EN 16931, just not routable.
  'no-buyer-vat': ['PEPPOL-EN16931-R010'],
}

export { NL_TENANT, CASES, EXPECTED_PEPPOL_FAILURES }
