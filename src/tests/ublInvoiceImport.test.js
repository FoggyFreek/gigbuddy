// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseUblInvoice, UblParseError } from '../../server/utils/parseUblInvoice.js'
import { mapUblInvoiceToPurchase } from '../../server/utils/ublInvoiceToPurchase.js'
import { computePurchaseTotals } from '../../shared/purchaseTotals.js'
import { parseUblAmount, money } from '../../shared/peppol.js'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ublImport')
const siUbl = readFileSync(join(FIX, 'si-ubl-discount.xml'), 'utf8')

const codes = (warnings) => warnings.map((w) => w.code)
const mapNl = (doc) => mapUblInvoiceToPurchase(doc, { vatCountry: 'nl', today: '2026-01-01' })

// Builds a minimal but structurally valid Peppol BIS 3.0 invoice, so each test
// can state only the part it is about.
function invoiceXml({
  typeCode = '380',
  currency = 'EUR',
  lines = [{ net: '100.00', percent: '21.00', name: 'Line' }],
  allowanceCharges = '',
  monetary = null,
  taxTotal = null,
  root = 'Invoice',
} = {}) {
  const lineXml = lines.map((l, i) => `
    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">1.00</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${currency}">${l.net}</cbc:LineExtensionAmount>
      <cac:Item>
        ${l.name === null ? '' : `<cbc:Name>${l.name}</cbc:Name>`}
        ${l.percent === null ? '' : `<cac:ClassifiedTaxCategory>
          <cbc:ID>${l.category ?? 'S'}</cbc:ID>
          <cbc:Percent>${l.percent}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>`}
      </cac:Item>
    </cac:InvoiceLine>`).join('')

  const net = lines.reduce((sum, l) => sum + Number(l.net), 0)
  const tax = lines.reduce((sum, l) => sum + (Number(l.net) * Number(l.percent ?? 0)) / 100, 0)

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-1</cbc:ID>
  <cbc:IssueDate>2026-03-04</cbc:IssueDate>
  <cbc:DueDate>2026-04-04</cbc:DueDate>
  <cbc:InvoiceTypeCode>${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyLegalEntity><cbc:RegistrationName>Acme BV</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  ${allowanceCharges}
  ${taxTotal ?? `<cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${tax.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${net.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${tax.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID><cbc:Percent>${lines[0].percent ?? '0.00'}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`}
  ${monetary ?? `<cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${net.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${net.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${(net + tax).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${(net + tax).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`}
  ${lineXml}
</${root}>`
}

describe('parseUblAmount', () => {
  it('is the inverse of money() across the awkward values', () => {
    for (const cents of [0, 1, 99, 100, 829, -1234, 119790, 2147483]) {
      expect(parseUblAmount(money(cents))).toBe(cents)
    }
  })

  it('scales without floating-point drift', () => {
    // 8.29 * 100 is 828.9999999999999 in IEEE 754 — the reason for the string path.
    expect(parseUblAmount('8.29')).toBe(829)
    expect(parseUblAmount('1234.56')).toBe(123456)
    expect(parseUblAmount('-0.01')).toBe(-1)
  })

  it('accepts more than two decimals by rounding the remainder in', () => {
    expect(parseUblAmount('0.005')).toBe(1)
    expect(parseUblAmount('10.004')).toBe(1000)
  })

  it('returns null for anything that is not an XSD decimal', () => {
    for (const bad of [null, undefined, '', 'abc', '1,00', '1.2.3', '1e3', ' ']) {
      expect(parseUblAmount(bad)).toBeNull()
    }
  })
})

describe('parseUblInvoice — the SI-UBL 1.2 shape', () => {
  const doc = parseUblInvoice(siUbl)

  it('reads the document header', () => {
    expect(doc.invoiceNumber).toBe('20260038')
    expect(doc.issueDate).toBe('2026-07-29')
    expect(doc.currency).toBe('EUR')
  })

  it('takes the due date from PaymentMeans when there is no cbc:DueDate', () => {
    expect(siUbl).not.toContain('<cbc:DueDate>')
    expect(doc.dueDate).toBe('2026-08-12')
  })

  it("reads a line's VAT rate from its own TaxTotal when ClassifiedTaxCategory is absent", () => {
    expect(siUbl).not.toContain('<cac:ClassifiedTaxCategory>')
    expect(doc.lines.map((l) => l.category)).toEqual([
      { code: 'S', percent: 21 },
      { code: 'S', percent: 21 },
    ])
  })

  it('reads the supplier, its identifiers and the payee IBAN', () => {
    expect(doc.supplier.name).toBe('Recording Studio De Kerk')
    expect(doc.supplier.vatId).toBe('NL001794860B34')
    expect(doc.supplier.registrationId).toBe('50048295')
    expect(doc.payeeIban).toBe('NL55RABO0127957391')
  })

  it('reads the document-level discount with the category it applies to', () => {
    expect(doc.allowanceCharges).toEqual([
      { kind: 'allowance', cents: 11000, reason: 'Factuurkorting', category: { code: 'S', percent: 21 } },
    ])
  })

  it('reads the stated totals rather than re-deriving them', () => {
    expect(doc.totals).toMatchObject({
      lineExtensionCents: 110000,
      taxExclusiveCents: 99000,
      taxInclusiveCents: 119790,
      allowanceTotalCents: 11000,
      payableCents: 119790,
      taxCents: 20790,
    })
  })

  it('extracts the embedded PDF', () => {
    expect(doc.attachments).toHaveLength(1)
    expect(doc.attachments[0].mimeCode).toBe('application/pdf')
    expect(doc.attachments[0].bytes.subarray(0, 5).toString()).toBe('%PDF-')
  })
})

describe('parseUblInvoice — what it refuses', () => {
  it('rejects a CreditNote document', () => {
    const xml = invoiceXml().replace('<Invoice ', '<CreditNote ').replace('</Invoice>', '</CreditNote>')
    expect(() => parseUblInvoice(xml)).toThrow(UblParseError)
  })

  it('rejects an Invoice carrying a credit-note type code', () => {
    expect(() => parseUblInvoice(invoiceXml({ typeCode: '381' })))
      .toThrow(/credit note/)
  })

  it('rejects a document that is not a UBL invoice at all', () => {
    expect(() => parseUblInvoice('<Document><BkToCstmrStmt/></Document>'))
      .toThrow(/not a UBL Invoice/)
  })

  it('falls back to the currency the totals are stated in, so a foreign invoice is still caught', () => {
    const xml = invoiceXml({ currency: 'USD' }).replace(/<cbc:DocumentCurrencyCode>.*<\/cbc:DocumentCurrencyCode>/, '')
    expect(parseUblInvoice(xml).currency).toBe('USD')
  })

  it('rejects an invoice with no lines', () => {
    const xml = invoiceXml().replace(/<cac:InvoiceLine>[\s\S]*<\/cac:InvoiceLine>/, '')
    expect(() => parseUblInvoice(xml)).toThrow(/no invoice lines/)
  })
})

describe('mapUblInvoiceToPurchase', () => {
  it('reconciles the discounted invoice to the cent', () => {
    const { purchase, warnings } = mapNl(parseUblInvoice(siUbl))
    const totals = computePurchaseTotals({ lines: purchase.lines })

    // The figures the supplier states, reached from gross lines a purchase can hold.
    expect(totals.subtotalCents).toBe(99000)
    expect(totals.taxCents).toBe(20790)
    expect(totals.totalCents).toBe(119790)
    // The EUR 110 discount, split across the lines in proportion to their size.
    expect(purchase.lines.map((l) => l.amount_incl_cents)).toEqual([65340, 54450])
    expect(codes(warnings)).toEqual(['document_discount_allocated'])
  })

  it('carries the header onto the purchase and always imports as a draft', () => {
    const { purchase } = mapNl(parseUblInvoice(siUbl))
    expect(purchase).toMatchObject({
      supplier_name: 'Recording Studio De Kerk',
      receipt_date: '2026-07-29',
      due_date: '2026-08-12',
      currency: 'EUR',
      status: 'draft',
    })
    // The supplier's own invoice number has nowhere else to live on a purchase.
    expect(purchase.memo).toBe('20260038')
  })

  it('spreads a document-level charge onto the lines too', () => {
    const charge = `<cac:AllowanceCharge>
      <cbc:ChargeIndicator>true</cbc:ChargeIndicator>
      <cbc:Amount currencyID="EUR">10.00</cbc:Amount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:AllowanceCharge>`
    const monetary = `<cac:LegalMonetaryTotal>
      <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
      <cbc:TaxExclusiveAmount currencyID="EUR">110.00</cbc:TaxExclusiveAmount>
      <cbc:TaxInclusiveAmount currencyID="EUR">133.10</cbc:TaxInclusiveAmount>
      <cbc:ChargeTotalAmount currencyID="EUR">10.00</cbc:ChargeTotalAmount>
      <cbc:PayableAmount currencyID="EUR">133.10</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>`
    const { purchase, warnings } = mapNl(parseUblInvoice(invoiceXml({ allowanceCharges: charge, monetary })))

    expect(computePurchaseTotals({ lines: purchase.lines }).totalCents).toBe(13310)
    expect(codes(warnings)).toContain('document_charge_allocated')
  })

  it('snaps a rate the tenant cannot book, and says so', () => {
    const { purchase, warnings } = mapNl(parseUblInvoice(
      invoiceXml({ lines: [{ net: '100.00', percent: '17.50', name: 'Odd rate' }] }),
    ))
    expect(purchase.lines[0].tax_rate).toBe(21)
    expect(warnings.find((w) => w.code === 'vat_rate_adjusted')).toMatchObject({ from: 17.5, to: 21 })
  })

  it('keeps a zero-rated line at 0% instead of defaulting it to the standard rate', () => {
    const { purchase, warnings } = mapNl(parseUblInvoice(invoiceXml({
      lines: [{ net: '100.00', percent: '0.00', category: 'AE', name: 'Reverse charge' }],
    })))
    expect(purchase.lines[0].tax_rate).toBe(0)
    expect(purchase.lines[0].amount_incl_cents).toBe(10000)
    expect(codes(warnings)).not.toContain('line_vat_rate_defaulted')
  })

  it("takes a line's missing rate from the document breakdown rather than booking it at 0%", () => {
    // snapVatRate reads a null rate as a valid 0%, so an unstated rate has to be
    // resolved before it reaches there or a taxed line is booked as zero-rated.
    const taxTotal = `<cac:TaxTotal>
      <cbc:TaxAmount currencyID="EUR">21.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="EUR">21.00</cbc:TaxAmount>
        <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21.00</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>`
    const monetary = `<cac:LegalMonetaryTotal>
      <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
      <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
      <cbc:TaxInclusiveAmount currencyID="EUR">121.00</cbc:TaxInclusiveAmount>
      <cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>`
    const { purchase, warnings } = mapNl(parseUblInvoice(invoiceXml({
      lines: [{ net: '100.00', percent: null, name: 'No rate stated' }], taxTotal, monetary,
    })))
    expect(purchase.lines[0].tax_rate).toBe(21)
    expect(warnings.find((w) => w.code === 'line_vat_rate_defaulted')).toMatchObject({ to: 21 })
  })

  it('flags a line with no description, which cannot be approved', () => {
    const { warnings } = mapNl(parseUblInvoice(
      invoiceXml({ lines: [{ net: '100.00', percent: '21.00', name: null }] }),
    ))
    expect(warnings.find((w) => w.code === 'line_missing_description'))
      .toMatchObject({ severity: 'blocking' })
  })

  it('absorbs a cent of rounding so the total matches the invoice', () => {
    // 8.29 net at 21% is 10.0309 gross; the document states 10.03.
    const { purchase, warnings } = mapNl(parseUblInvoice(
      invoiceXml({ lines: [{ net: '8.29', percent: '21.00', name: 'Rounds down' }] }),
    ))
    expect(computePurchaseTotals({ lines: purchase.lines }).totalCents).toBe(1003)
    expect(codes(warnings)).not.toContain('totals_mismatch')
  })

  it('reports a gap too large to be rounding instead of forcing it onto a line', () => {
    const monetary = `<cac:LegalMonetaryTotal>
      <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
      <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
      <cbc:TaxInclusiveAmount currencyID="EUR">200.00</cbc:TaxInclusiveAmount>
      <cbc:PayableAmount currencyID="EUR">200.00</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>`
    const { purchase, warnings } = mapNl(parseUblInvoice(invoiceXml({ monetary })))

    // Left as the lines actually state, for the user to resolve in the draft.
    expect(computePurchaseTotals({ lines: purchase.lines }).totalCents).toBe(12100)
    expect(warnings.find((w) => w.code === 'totals_mismatch'))
      .toMatchObject({ severity: 'blocking', cents: 7900, statedCents: 20000 })
  })

  it('books the full amount when part of the invoice was prepaid, and says so', () => {
    const monetary = `<cac:LegalMonetaryTotal>
      <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
      <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
      <cbc:TaxInclusiveAmount currencyID="EUR">121.00</cbc:TaxInclusiveAmount>
      <cbc:PrepaidAmount currencyID="EUR">21.00</cbc:PrepaidAmount>
      <cbc:PayableAmount currencyID="EUR">100.00</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>`
    const { purchase, warnings } = mapNl(parseUblInvoice(invoiceXml({ monetary })))

    expect(computePurchaseTotals({ lines: purchase.lines }).totalCents).toBe(12100)
    expect(warnings.find((w) => w.code === 'prepaid_amount_ignored')).toMatchObject({ cents: 2100 })
  })
})
