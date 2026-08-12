// @vitest-environment node
//
// Validates rendered invoices against the OFFICIAL EN 16931 CEN Schematron
// rather than against rules we transcribed by hand. renderInvoiceUbl.test.js
// asserts structure and arithmetic; this asserts conformance.
//
// Skipped unless `npm run build:schematron` has produced the SEF bundle, so
// neither local dev nor CI hard-depends on a third-party artefact.
import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { renderInvoiceUbl } from '../../../../server/utils/renderInvoiceUbl.js'
import { checkPeppolReadiness } from '../../../../shared/peppolReadiness.js'
import { CASES, EXPECTED_PEPPOL_FAILURES } from '../../../tests/fixtures/ubl/cases.js'
import {
  describeFailures,
  schematronAvailable,
  schematronVersion,
  validateEn16931,
  validatePeppol,
} from '../../../tests/fixtures/ubl/validator.js'

const expectValid = (xml) => {
  expect(describeFailures(validateEn16931(xml))).toEqual([])
}

const base = CASES['nl-standard']
// A buyer we can fully identify, so a variant fails only for the reason it tests.
const NL_BUYER = {
  customer_address_country: 'NL',
  customer_address_postal_code: '1011AB',
  customer_address_city: 'Amsterdam',
  customer_tax_id: 'NL819789471B01',
}
const withBuyer = (invoice) => ({ ...base.invoice, ...NL_BUYER, ...invoice })

// Each entry pins an assumption the renderer makes that our own tests could
// only assert by transcribing the spec.
const VARIANTS = {
  // BR-Z-*: a zero-rated line beside a standard-rated one — two categories,
  // one of which must carry no tax and no exemption reason.
  'zero-rated line beside a standard-rated one': {
    ...base,
    invoice: withBuyer(),
    lines: [
      { description: 'Performance', quantity: 1, unit_price_cents: 150000, tax_percentage: 21 },
      { description: 'Travel', quantity: 1, unit_price_cents: 5000, tax_percentage: 0 },
    ],
  },
  // Reverse charge plus a discount: the other half of the UBL-CR-481 shape that
  // the kor-discount golden pins (AE rather than E).
  'reverse charge carrying a document discount': {
    ...base,
    invoice: withBuyer({
      reverse_charge: true,
      customer_address_country: 'BE',
      customer_tax_id: 'BE0779341748',
      discount_type: 'pct',
      discount_pct: 15,
    }),
  },
  // Backing VAT out of gross prices — the PriceAmount precision path (R120).
  'tax-inclusive prices': {
    ...base,
    invoice: withBuyer({ tax_inclusive: true }),
    lines: [{ description: 'Performance', quantity: 10, unit_price_cents: 10000, tax_percentage: 21 }],
  },
  // Per-line VAT summed across many lines drifts from rate x base; BR-S-09 and
  // BR-CO-17 allow under one currency unit.
  'tax-inclusive across forty lines': {
    ...base,
    invoice: withBuyer({ tax_inclusive: true }),
    lines: Array.from({ length: 40 }, (_, i) => ({
      description: `Line ${i + 1}`, quantity: 1, unit_price_cents: 10001, tax_percentage: 21,
    })),
  },
  'discount of one hundred percent': {
    ...base,
    invoice: withBuyer({ discount_type: 'pct', discount_pct: 100 }),
  },
  'fractional quantity': {
    ...base,
    invoice: withBuyer(),
    lines: [{ description: 'Half day', quantity: 2.5, unit_price_cents: 33333, tax_percentage: 21 }],
  },
  // A quantity that does not divide the line net cleanly (R120 tolerance).
  'quantity that does not divide the net cleanly': {
    ...base,
    invoice: withBuyer(),
    lines: [{ description: 'Session', quantity: 3, unit_price_cents: 10000, tax_percentage: 21 }],
  },
  // Optional groups dropping out entirely rather than emitting empty shells.
  'no IBAN, so no payment means': {
    ...base, tenant: { ...base.tenant, iban: null }, invoice: withBuyer(),
  },
  'no supply date, so no delivery': { ...base, invoice: withBuyer({ supply_date: null }) },
  'no memo, so no document note': { ...base, invoice: withBuyer({ memo: null }) },
  'no payment term': { ...base, invoice: withBuyer({ payment_term_days: null }) },
  'no linked gig, so the buyer reference falls back': {
    ...base, invoice: withBuyer({ event_description: null }),
  },
  'no customer contact details': {
    ...base,
    invoice: withBuyer({
      customer_email: null,
      customer_contact_title: null,
      customer_contact_given_name: null,
      customer_contact_family_name: null,
    }),
  },
  'no registration number on the supplier': {
    ...base, tenant: { ...base.tenant, kvk_number: null }, invoice: withBuyer(),
  },
}

describe.skipIf(!schematronAvailable())('e-invoicing conformance (official Schematrons)', () => {
  it('runs the vendored ruleset', () => {
    expect(schematronVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  describe('EN 16931 — committed goldens', () => {
    for (const [name, input] of Object.entries(CASES)) {
      it(`${name} is conformant`, () => expectValid(renderInvoiceUbl(input)))
    }
  })

  describe('EN 16931 — assumptions the hand-written tests can only approximate', () => {
    for (const [name, input] of Object.entries(VARIANTS)) {
      it(name, () => expectValid(renderInvoiceUbl(input)))
    }

    it('accepts an embedded invoice PDF', () => {
      const xml = renderInvoiceUbl({
        ...base,
        embeddedPdf: {
          filename: 'factuur-2026-0007.pdf',
          base64: Buffer.from('%PDF-1.7 invoice').toString('base64'),
        },
      })
      expectValid(xml)
      expect(validatePeppol(xml)).toEqual([])
    })

    it('accepts the missing-PDF notice without creating a second document note', () => {
      const xml = renderInvoiceUbl({
        ...base,
        invoice: { ...base.invoice, memo: 'Existing memo.' },
        embeddedPdf: null,
      })
      expectValid(xml)
      expect(validatePeppol(xml)).toEqual([])
    })
  })

  describe('Peppol BIS Billing 3.0 — goldens', () => {
    for (const [name, input] of Object.entries(CASES)) {
      const expected = EXPECTED_PEPPOL_FAILURES[name] ?? []
      it(expected.length === 0 ? `${name} is clean` : `${name} fails only ${expected.join(', ')}`, () => {
        const failures = validatePeppol(renderInvoiceUbl(input))
        expect(failures.map((f) => f.id).sort()).toEqual([...expected].sort())
      })
    }
  })

  // The warning model and the real validator must agree on which documents an
  // access point would reject — otherwise the UI hint is decoration.
  it('blocks exactly the documents Peppol rejects', () => {
    for (const [name, input] of Object.entries(CASES)) {
      const blocked = checkPeppolReadiness(input).some((w) => w.severity === 'blocking')
      const rejected = validatePeppol(renderInvoiceUbl(input)).length > 0
      expect(`${name}: blocked=${blocked}`).toBe(`${name}: blocked=${rejected}`)
    }
  })

  // Proves the harness has teeth: without these, "everything passes" could just
  // mean the validator is not looking. Both reproduce defects that slipped
  // through the structural suite.
  it('reports a PartyTaxScheme stating a tax scheme with no VAT identifier', () => {
    const broken = renderInvoiceUbl({ ...base, invoice: withBuyer() })
      .replace('<cbc:CompanyID>NL819789471B01</cbc:CompanyID>\n        ', '')
    expect(validateEn16931(broken).map((f) => f.id)).toContain('UBL-SR-53')
  })

  // The German blocker exists because Peppol enforces something EN 16931 leaves
  // optional. Pinning both halves keeps the warning honest: it must fire exactly
  // when the real rule would, and stop firing once the data is there.
  it('agrees with Peppol about a domestic German invoice missing seller contact', () => {
    const de = CASES['de-domestic']
    const stripped = { ...de, tenant: { ...de.tenant, email: null, phone: null } }
    const xml = renderInvoiceUbl(stripped)

    // BG-6 is optional in the core standard, so CEN is satisfied either way…
    expect(describeFailures(validateEn16931(xml))).toEqual([])
    // …while Peppol's German rules are not.
    expect(validatePeppol(xml).map((f) => f.id)).toContain('DE-R-002')
    expect(checkPeppolReadiness(stripped).map((w) => w.code)).toContain('de_domestic_contact_required')

    // With the contact details present, both agree it is fine.
    expect(validatePeppol(renderInvoiceUbl(de))).toEqual([])
    expect(checkPeppolReadiness(de).map((w) => w.code)).not.toContain('de_domestic_contact_required')
  })

  it('reports an exemption reason repeated on an allowance category', () => {
    const broken = renderInvoiceUbl(CASES['kor-discount']).replace(
      '      <cbc:Percent>0</cbc:Percent>\n',
      '      <cbc:Percent>0</cbc:Percent>\n      <cbc:TaxExemptionReason>Repeated</cbc:TaxExemptionReason>\n',
    )
    expect(validateEn16931(broken).map((f) => f.id)).toContain('UBL-CR-481')
  })
})
