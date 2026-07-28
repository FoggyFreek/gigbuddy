import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PEPPOL_WARNING_CODES, checkPeppolReadiness, isPeppolReady } from '../../shared/peppolReadiness.js'

// A tenant and invoice that are fully Peppol-ready, so each test can knock out
// exactly one thing and assert exactly one warning.
const TENANT = {
  formal_name: 'The Woods BV',
  band_name: 'The Woods',
  address_street: 'Middelhorsterweg 32',
  address_postal_code: '9751TG',
  address_city: 'Haren',
  address_country: 'Netherlands',
  vat_country: 'nl',
  tax_id: 'NL819789471B01',
  kvk_number: '12345678',
  iban: 'NL91ABNA0417164300',
  applies_kor: false,
}

const INVOICE = {
  invoice_number: '2026-0007',
  issue_date: '2026-07-28',
  customer_name: 'Jerboa BV',
  customer_address_street: 'Molendreef 67',
  customer_address_postal_code: '9920',
  customer_address_city: 'Lievegem',
  customer_address_country: 'BE',
  customer_tax_id: 'BE0779341748',
  customer_kvk: null,
  event_description: 'One Shot — Our Love',
  total_cents: 18150,
  tax_cents: 3150,
  reverse_charge: false,
}

const LINES = [{ description: 'Live performance', quantity: 1, unit_price_cents: 15000, tax_percentage: 21 }]

const check = (over = {}) => checkPeppolReadiness({
  invoice: { ...INVOICE, ...over.invoice },
  lines: over.lines ?? LINES,
  tenant: { ...TENANT, ...over.tenant },
})

const codes = (warnings) => warnings.map((w) => w.code)
const blocking = (warnings) => warnings.filter((w) => w.severity === 'blocking').map((w) => w.code)

describe('checkPeppolReadiness — the happy path', () => {
  it('reports only the inference caveat for a complete invoice', () => {
    expect(codes(check())).toEqual(['endpoint_inferred'])
    expect(isPeppolReady(check())).toBe(true)
  })

  it('always warns that the electronic addresses were inferred', () => {
    // Holding a VAT number does not prove the party registered it as a Peppol
    // participant, so this caveat is unconditional.
    expect(check().find((w) => w.code === 'endpoint_inferred').severity).toBe('advisory')
  })
})

describe('checkPeppolReadiness — electronic addresses', () => {
  it('blocks when the buyer cannot be addressed', () => {
    expect(blocking(check({ invoice: { customer_tax_id: null, customer_kvk: null } })))
      .toContain('missing_buyer_endpoint')
  })

  it('blocks when the seller cannot be addressed', () => {
    expect(blocking(check({ tenant: { tax_id: null, kvk_number: null } })))
      .toContain('missing_seller_endpoint')
  })

  it('accepts a Dutch buyer identified only by KVK number', () => {
    const warnings = check({
      invoice: {
        customer_tax_id: null, customer_kvk: '87654321',
        customer_address_country: 'NL', customer_address_postal_code: '1011AB',
      },
    })
    expect(blocking(warnings)).toEqual([])
    expect(codes(warnings)).toContain('missing_buyer_vat_id')
  })
})

describe('checkPeppolReadiness — postal countries', () => {
  it('blocks when a country cannot be resolved to an ISO code', () => {
    expect(blocking(check({ tenant: { address_country: 'Atlantis' } })))
      .toContain('unknown_seller_country')
    expect(blocking(check({ invoice: { customer_address_country: 'Atlantis' } })))
      .toContain('unknown_buyer_country')
  })

  it('takes the postal country from the address, not the VAT jurisdiction', () => {
    // A Dutch-registered band with a Belgian correspondence address: NL rules
    // must not fire, because the Schematron keys them on the postal country.
    const warnings = check({ tenant: { address_country: 'Belgium', address_postal_code: null } })
    expect(blocking(warnings)).not.toContain('missing_seller_postal_code')
  })
})

describe('checkPeppolReadiness — Dutch supplier rules', () => {
  it('requires the seller post code (NL-R-002)', () => {
    expect(blocking(check({ tenant: { address_postal_code: null } })))
      .toContain('missing_seller_postal_code')
  })

  it('requires the buyer post code only when the buyer is also Dutch (NL-R-004)', () => {
    const dutchBuyer = { customer_address_country: 'NL', customer_tax_id: 'NL819789471B01', customer_address_postal_code: null }
    expect(blocking(check({ invoice: dutchBuyer }))).toContain('missing_buyer_postal_code')
    // Belgian buyer — NL-R-004 does not apply.
    expect(blocking(check({ invoice: { customer_address_postal_code: null } })))
      .not.toContain('missing_buyer_postal_code')
  })

  it('requires payment instructions for any Dutch supplier, not just domestic ones', () => {
    // NL-R-007 contexts on the supplier country alone; the Belgian buyer here
    // does not exempt it.
    expect(blocking(check({ tenant: { iban: null } }))).toContain('missing_payment_account')
  })

  it('does not require payment instructions when nothing is payable', () => {
    expect(blocking(check({ tenant: { iban: null }, invoice: { total_cents: 0 } })))
      .not.toContain('missing_payment_account')
  })
})

describe('checkPeppolReadiness — German domestic rules', () => {
  const german = {
    tenant: {
      address_country: 'Germany', address_postal_code: '10115', vat_country: 'de',
      tax_id: 'DE136695976', iban: null,
    },
    invoice: {
      customer_address_country: 'Germany', customer_address_postal_code: null,
      customer_tax_id: 'DE136695976',
    },
  }

  it('blocks when the band publishes no contact details (DE-R-002/005/006/007)', () => {
    expect(blocking(check(german))).toContain('de_domestic_contact_required')
  })

  it('stops blocking once a business email and phone are on the profile', () => {
    const reachable = {
      ...german,
      tenant: { ...german.tenant, email: 'buchung@band.example', phone: '+49 30 1234567' },
    }
    expect(blocking(check(reachable))).not.toContain('de_domestic_contact_required')
  })

  it('still blocks when only one of the two is filled in', () => {
    // DE-R-006 and DE-R-007 are separate rules; either alone leaves the document
    // invalid, so a half-filled profile must not read as ready.
    for (const half of [{ email: 'b@band.example' }, { phone: '+49 30 1234567' }]) {
      const warnings = check({ ...german, tenant: { ...german.tenant, ...half } })
      expect(blocking(warnings)).toContain('de_domestic_contact_required')
    }
  })

  it('requires payment instructions (DE-R-001)', () => {
    expect(blocking(check(german))).toContain('missing_payment_account')
  })

  it('requires the buyer post code (DE-R-009)', () => {
    expect(blocking(check(german))).toContain('missing_buyer_postal_code')
  })

  it('requires the seller post code (DE-R-004)', () => {
    const warnings = check({ ...german, tenant: { ...german.tenant, address_postal_code: null } })
    expect(blocking(warnings)).toContain('missing_seller_postal_code')
  })

  it('leaves a German supplier with a foreign buyer alone', () => {
    const warnings = check({
      tenant: { ...german.tenant, iban: 'DE89370400440532013000' },
      invoice: { customer_address_country: 'BE', customer_tax_id: 'BE0779341748' },
    })
    expect(blocking(warnings)).toEqual([])
  })
})

describe('checkPeppolReadiness — content', () => {
  it('blocks a line with no description (BR-25)', () => {
    expect(blocking(check({ lines: [{ ...LINES[0], description: '  ' }] })))
      .toContain('line_missing_name')
  })

  it('notes when the buyer reference had to fall back to the invoice number', () => {
    const warnings = check({ invoice: { event_description: null } })
    expect(codes(warnings)).toContain('buyer_reference_defaulted')
    expect(warnings.find((w) => w.code === 'buyer_reference_defaulted').severity).toBe('advisory')
  })

  it('notes a missing buyer VAT number', () => {
    const warnings = check({
      invoice: { customer_tax_id: null, customer_kvk: '87654321', customer_address_country: 'NL', customer_address_postal_code: '1011AB' },
    })
    expect(codes(warnings)).toContain('missing_buyer_vat_id')
  })
})

describe('checkPeppolReadiness — ordering and shape', () => {
  it('lists blocking warnings before advisory ones', () => {
    const warnings = check({ tenant: { tax_id: null, kvk_number: null } })
    const firstAdvisory = warnings.findIndex((w) => w.severity === 'advisory')
    const lastBlocking = warnings.map((w) => w.severity).lastIndexOf('blocking')
    expect(lastBlocking).toBeLessThan(firstAdvisory)
  })

  it('only ever emits declared codes', () => {
    for (const w of check({ tenant: { tax_id: null, address_country: 'Atlantis', iban: null } })) {
      expect(PEPPOL_WARNING_CODES).toContain(w.code)
    }
  })
})

describe('warning translations', () => {
  it.each(['en', 'nl'])('the %s bundle translates every warning code', (lng) => {
    const bundle = JSON.parse(readFileSync(
      resolve(globalThis.process.cwd(), `src/i18n/${lng}/invoices.json`), 'utf8',
    ))
    expect(Object.keys(bundle.ubl.warnings).sort()).toEqual([...PEPPOL_WARNING_CODES].sort())
    for (const message of Object.values(bundle.ubl.warnings)) {
      expect(String(message).length).toBeGreaterThan(10)
    }
  })
})
