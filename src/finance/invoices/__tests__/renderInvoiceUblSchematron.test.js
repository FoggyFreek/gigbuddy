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
import { buildGigDealInvoiceLines } from '../../../../shared/gigDealInvoiceLines.js'
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

// The real draft-from-gig decomposition, rendered as invoice lines: this is the
// exact shape the invoice endpoint hands a venue for a deal that shares in the
// door, so it is the shape the official rules have to accept.
const dealSettlementLines = (terms, mode = 'combined') => buildGigDealInvoiceLines(terms, { mode }).map((line) => ({
  description: line.kind,
  quantity: line.quantity,
  unit_price_cents: line.unitPriceCents,
  tax_percentage: 21,
}))

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
  // A gig billed as the deal that produced the amount: ticket revenue, what the
  // venue recoups and its share of the rest. The deductions are what make the
  // shape unusual — the document states them as a positive quantity at a
  // NEGATIVE AMOUNT (money adjusted, not stock returned), which only survives
  // BR-27 because the renderer moves that sign onto the quantity.
  'a door deal billed as its settlement': {
    ...base,
    invoice: withBuyer(),
    lines: dealSettlementLines({
      deal_type: 'door_deal',
      venue_costs_cents: 30000,
      tickets_sold: 200,
      ticket_price_net_cents: 1000,
      percentage_of_sales: 70,
    }),
  },
  'a guarantee billed with its break-even itemised': {
    ...base,
    invoice: withBuyer(),
    lines: dealSettlementLines({
      deal_type: 'guarantee',
      guaranteed_fee_cents: 50000,
      venue_costs_cents: 30000,
      tickets_sold: 200,
      ticket_price_net_cents: 1000,
      percentage_of_sales: 70,
    }),
  },
  'a specified booking fee split from the artist fee': {
    ...base,
    invoice: withBuyer(),
    lines: dealSettlementLines({
      deal_type: 'flat_fee',
      guaranteed_fee_cents: 100000,
      agency_fee_basis: 'amount',
      agency_fee_amount_cents: 15000,
    }, 'specified'),
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

    // Peppol adds R120 (line net vs quantity x price) on top of BR-27, and both
    // have to hold for a settlement carrying negative deduction lines.
    it('accepts a deal settlement on the Peppol profile too', () => {
      const xml = renderInvoiceUbl({
        ...base,
        invoice: withBuyer(),
        lines: dealSettlementLines({
          deal_type: 'guarantee',
          guarantee_variant: 'versus',
          guaranteed_fee_cents: 50000,
          tickets_sold: 200,
          ticket_price_net_cents: 1000,
          percentage_of_sales: 70,
        }),
      })
      expectValid(xml)
      expect(validatePeppol(xml)).toEqual([])
    })

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

  // The document keeps a deduction as a positive quantity at a negative amount;
  // BR-27 makes that fatal on the wire, so the renderer swaps the sign onto the
  // quantity. Both halves are pinned: that the swap happens, and that it is
  // needed — an unswapped line is rejected by the real ruleset.
  it('moves a deduction line sign onto the quantity, as BR-27 requires', () => {
    const deduction = { description: 'Venue costs', quantity: 1, unit_price_cents: -30000, tax_percentage: 21 }
    const xml = renderInvoiceUbl({
      ...base,
      invoice: withBuyer(),
      lines: [{ description: 'Ticket revenue', quantity: 200, unit_price_cents: 1000, tax_percentage: 21 }, deduction],
    })
    expectValid(xml)
    expect(validatePeppol(xml)).toEqual([])

    const line = xml.split('<cac:InvoiceLine>')[2]
    expect(line).toContain('<cbc:InvoicedQuantity unitCode="C62">-1.00</cbc:InvoicedQuantity>')
    expect(line).toContain('<cbc:LineExtensionAmount currencyID="EUR">-300.00</cbc:LineExtensionAmount>')
    expect(line).toContain('<cbc:PriceAmount currencyID="EUR">300.00</cbc:PriceAmount>')

    // Without the swap — the shape the document itself uses — CEN says no.
    const unswapped = xml
      .replace('<cbc:InvoicedQuantity unitCode="C62">-1.00', '<cbc:InvoicedQuantity unitCode="C62">1.00')
      .replace('<cbc:PriceAmount currencyID="EUR">300.00', '<cbc:PriceAmount currencyID="EUR">-300.00')
    expect(validateEn16931(unswapped).map((f) => f.id)).toContain('BR-27')
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
