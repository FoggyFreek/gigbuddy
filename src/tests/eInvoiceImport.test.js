// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseUblInvoice } from '../../server/utils/eInvoice/ubl.js'
import { parseCiiInvoice } from '../../server/utils/eInvoice/cii.js'
import { parseEInvoice, EInvoiceParseError } from '../../server/utils/eInvoice/index.js'
import { mapEInvoiceToPurchase } from '../../server/utils/eInvoiceToPurchase.js'
import { computePurchaseTotals } from '../../shared/purchaseTotals.js'
import { parseUblAmount, money } from '../../shared/peppol.js'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ublImport')
const siUbl = readFileSync(join(FIX, 'si-ubl-discount.xml'), 'utf8')

const codes = (warnings) => warnings.map((w) => w.code)
const mapNl = (doc) => mapEInvoiceToPurchase(doc, { vatCountry: 'nl', today: '2026-01-01' })

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
    expect(() => parseUblInvoice(xml)).toThrow(EInvoiceParseError)
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

// EN 16931 marks these mandatory, and each one changes how the bill is booked.
// Defaulting any of them puts a guess into the ledger.
describe('parseUblInvoice — mandatory fields are not defaulted', () => {
  const strip = (tag) => invoiceXml().replace(new RegExp(`<cbc:${tag}>[^<]*</cbc:${tag}>`), '')

  it('rejects an invoice with no currency rather than assuming EUR', () => {
    const xml = strip('DocumentCurrencyCode')
      .replaceAll(' currencyID="EUR"', '')
    expect(() => parseUblInvoice(xml)).toThrow(/BT-5/)
  })

  it('rejects a missing issue date rather than booking it today', () => {
    expect(() => parseUblInvoice(strip('IssueDate'))).toThrow(/BT-2/)
  })

  it('rejects an unparseable issue date', () => {
    const xml = invoiceXml().replace('<cbc:IssueDate>2026-03-04</cbc:IssueDate>', '<cbc:IssueDate>04-03-2026</cbc:IssueDate>')
    expect(() => parseUblInvoice(xml)).toThrow(/BT-2/)
  })

  it('rejects a missing invoice number', () => {
    expect(() => parseUblInvoice(strip('ID'))).toThrow(/BT-1/)
  })

  it('rejects a missing invoice type code, which could be an unlabelled credit note', () => {
    expect(() => parseUblInvoice(strip('InvoiceTypeCode'))).toThrow(/BT-3/)
  })

  it('rejects an invoice stating no total, leaving the lines with nothing to reconcile against', () => {
    const monetary = `<cac:LegalMonetaryTotal>
      <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
    </cac:LegalMonetaryTotal>`
    expect(() => parseUblInvoice(invoiceXml({ monetary }))).toThrow(/BT-112 \/ BT-115/)
  })
})

describe('parseUblInvoice — namespace and currency integrity', () => {
  it('rejects a root element that is not in the UBL Invoice namespace', () => {
    const xml = invoiceXml().replace(
      'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
      'xmlns="urn:example:not-ubl"',
    )
    expect(() => parseUblInvoice(xml)).toThrow(/not a UBL Invoice document/)
  })

  it('rejects a prefixed root bound to another namespace', () => {
    // removeNSPrefix would otherwise make this parse as a plain <Invoice>.
    const xml = `<?xml version="1.0"?><evil:Invoice xmlns:evil="urn:example:evil"><evil:ID>X</evil:ID></evil:Invoice>`
    expect(() => parseUblInvoice(xml)).toThrow(/not a UBL Invoice document/)
  })

  it('accepts a prefixed root correctly bound to the UBL namespace', () => {
    const xml = invoiceXml()
      .replace('<Invoice xmlns=', '<ubl:Invoice xmlns:ubl=')
      .replace('</Invoice>', '</ubl:Invoice>')
    expect(parseUblInvoice(xml).invoiceNumber).toBe('INV-1')
  })

  it('rejects a document that mixes currencies across its amounts', () => {
    const xml = invoiceXml().replace(
      '<cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>',
      '<cbc:LineExtensionAmount currencyID="USD">100.00</cbc:LineExtensionAmount>',
    )
    expect(() => parseUblInvoice(xml)).toThrow(/mixes currencies/)
  })
})

describe('mapEInvoiceToPurchase', () => {
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
      // BT-1, in its own column rather than folded into free text.
      supplier_invoice_number: '20260038',
    })
    expect(purchase.memo).toBeNull()
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

  it('flags a reverse-charge line instead of letting it look like an ordinary 0% bill', () => {
    const { purchase, warnings } = mapNl(parseUblInvoice(invoiceXml({
      lines: [{ net: '100.00', percent: '0.00', category: 'AE', name: 'Gear from Germany' }],
    })))
    // 0% is a faithful record of what the supplier charged...
    expect(purchase.lines[0].tax_rate).toBe(0)
    // ...but the buyer still owes that VAT, and a purchase cannot hold both legs.
    expect(warnings.find((w) => w.code === 'vat_self_assessment_required'))
      .toMatchObject({ severity: 'blocking', category: 'AE' })
  })

  it('flags an intra-community acquisition the same way', () => {
    const { warnings } = mapNl(parseUblInvoice(invoiceXml({
      lines: [{ net: '100.00', percent: '0.00', category: 'K', name: 'EU acquisition' }],
    })))
    expect(warnings.find((w) => w.code === 'vat_self_assessment_required'))
      .toMatchObject({ category: 'K' })
  })

  it('does not flag a genuinely zero-rated or exempt line', () => {
    for (const category of ['Z', 'E', 'O']) {
      const { warnings } = mapNl(parseUblInvoice(invoiceXml({
        lines: [{ net: '100.00', percent: '0.00', category, name: 'Zero rated' }],
      })))
      expect(codes(warnings)).not.toContain('vat_self_assessment_required')
    }
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

// ---------------------------------------------------------------------------
// CII — the other syntax EN 16931 permits, and the one Germany and France send.
// ---------------------------------------------------------------------------

const cii = readFileSync(join(FIX, 'cii-xrechnung.xml'), 'utf8')

describe('parseCiiInvoice — a German XRechnung in CII syntax', () => {
  const doc = parseCiiInvoice(cii)

  it('reads the header, converting YYYYMMDD dates', () => {
    expect(cii).toContain('format="102"')
    expect(doc).toMatchObject({
      syntax: 'cii',
      invoiceNumber: 'RE-2026-0042',
      issueDate: '2026-07-15',
      dueDate: '2026-08-14',
      currency: 'EUR',
      typeCode: '380',
    })
  })

  it('reads the seller from SellerTradeParty, VAT number qualified by schemeID', () => {
    expect(doc.supplier).toMatchObject({
      name: 'Tonstudio Hansa GmbH',
      vatId: 'DE123456789',
      registrationId: 'HRB 12345',
      country: 'DE',
      city: 'Berlin',
    })
    expect(doc.payeeIban).toBe('DE02120300000000202051')
  })

  it("reads the allowance despite ChargeIndicator's extra nesting", () => {
    expect(doc.allowanceCharges).toEqual([
      { kind: 'allowance', cents: 5000, reason: 'Rabatt', category: { code: 'S', percent: 19 } },
    ])
  })

  it("maps CII's own total names onto the same normalized totals", () => {
    expect(doc.totals).toMatchObject({
      lineExtensionCents: 100000,   // LineTotalAmount        BT-106
      taxExclusiveCents: 95000,     // TaxBasisTotalAmount    BT-109
      taxInclusiveCents: 113050,    // GrandTotalAmount       BT-112
      payableCents: 113050,         // DuePayableAmount       BT-115
      taxCents: 18050,
    })
  })

  it('produces a purchase reconciling to the German invoice exactly', () => {
    const { purchase } = mapNl(doc)
    const totals = computePurchaseTotals({ lines: purchase.lines })
    expect([totals.subtotalCents, totals.taxCents, totals.totalCents]).toEqual([95000, 18050, 113050])
    // 19% is a real rate in a supported country, so it survives the snap even
    // though this tenant is Dutch.
    expect(purchase.lines.map((l) => l.tax_rate)).toEqual([19, 19])
  })

  it('rejects a CII credit note, which shares the invoice root element', () => {
    const creditNote = cii.replace('<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>381</ram:TypeCode>')
    // There is no separate CreditNote root in CII — BT-3 is the only guard.
    expect(() => parseCiiInvoice(creditNote)).toThrow(/credit note/)
  })

  it('rejects a CII invoice with no type code at all', () => {
    expect(() => parseCiiInvoice(cii.replace('<ram:TypeCode>380</ram:TypeCode>', '')))
      .toThrow(/BT-3/)
  })

  it('refuses a date in a format that is not a calendar day', () => {
    const monthOnly = cii.replace('<udt:DateTimeString format="102">20260715</udt:DateTimeString>',
      '<udt:DateTimeString format="610">202607</udt:DateTimeString>')
    expect(() => parseCiiInvoice(monthOnly)).toThrow(/BT-2/)
  })
})

// ---------------------------------------------------------------------------
// Factur-X MINIMUM / BASIC WL — totals, no line detail.
// ---------------------------------------------------------------------------

// Strips every line item, leaving the summary a MINIMUM profile would send.
const minimumProfile = () => cii.replace(
  /<ram:IncludedSupplyChainTradeLineItem>[\s\S]*<\/ram:IncludedSupplyChainTradeLineItem>/,
  '',
).replace(
  'urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0',
  'urn:factur-x.eu:1p0:minimum',
)

describe('Factur-X MINIMUM / BASIC WL — no line items', () => {
  it('parses despite carrying no lines, because that profile is legitimate', () => {
    const doc = parseCiiInvoice(minimumProfile())
    expect(doc.lines).toEqual([])
    expect(doc.customizationId).toBe('urn:factur-x.eu:1p0:minimum')
    expect(doc.totals.taxInclusiveCents).toBe(113050)
  })

  it('synthesizes one line carrying the right money, and says it did', () => {
    const { purchase, warnings } = mapNl(parseCiiInvoice(minimumProfile()))

    expect(purchase.lines).toHaveLength(1)
    const totals = computePurchaseTotals({ lines: purchase.lines })
    expect([totals.subtotalCents, totals.taxCents, totals.totalCents]).toEqual([95000, 18050, 113050])
    // Taken from the dominant VAT category in the document breakdown.
    expect(purchase.lines[0].tax_rate).toBe(19)

    expect(warnings.find((w) => w.code === 'lines_synthesized_from_totals'))
      .toMatchObject({ severity: 'blocking' })
    // No description to synthesize, so this must be resolved too.
    expect(codes(warnings)).toContain('line_missing_description')
  })

  it('does not deduct the invoice discount twice', () => {
    // The synthesized line comes from the ALREADY discounted TaxBasisTotalAmount,
    // so allocating the allowance again would take the 50.00 off twice.
    const { purchase, warnings } = mapNl(parseCiiInvoice(minimumProfile()))
    expect(computePurchaseTotals({ lines: purchase.lines }).subtotalCents).toBe(95000)
    expect(codes(warnings)).not.toContain('document_discount_allocated')
  })
})

// ---------------------------------------------------------------------------
// The dispatcher: syntax and container sniffing.
// ---------------------------------------------------------------------------

// Builds a hybrid PDF the way Factur-X does — a readable page plus the CII XML
// as an embedded file. Real senders produce PDF/A-3; pdfkit's plain PDF is
// enough to prove the extraction, which reads the attachment tree either way.
async function facturXPdf(xml, name = 'factur-x.xml') {
  const { default: PDFDocument } = await import('pdfkit')
  const doc = new PDFDocument()
  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise((resolve) => doc.on('end', resolve))
  doc.text('Rechnung RE-2026-0042')
  doc.file(Buffer.from(xml), { name })
  doc.end()
  await done
  return Buffer.concat(chunks)
}

describe('parseEInvoice — picks the reader from the bytes', () => {
  it('reads a UBL invoice from an .xml upload', async () => {
    const doc = await parseEInvoice(Buffer.from(siUbl))
    expect(doc.syntax).toBe('ubl')
  })

  it('reads a CII invoice from an .xml upload', async () => {
    const doc = await parseEInvoice(Buffer.from(cii))
    expect(doc.syntax).toBe('cii')
  })

  it('reads the CII out of a Factur-X PDF', async () => {
    const doc = await parseEInvoice(await facturXPdf(cii))
    expect(doc.syntax).toBe('cii')
    expect(doc.invoiceNumber).toBe('RE-2026-0042')
    expect(doc.totals.taxInclusiveCents).toBe(113050)
  })

  it('reads a ZUGFeRD 2.x PDF, which uses the other mandated filename', async () => {
    const doc = await parseEInvoice(await facturXPdf(cii, 'zugferd-invoice.xml'))
    expect(doc.invoiceNumber).toBe('RE-2026-0042')
  })

  it('tells the user what to do with an ordinary PDF invoice', async () => {
    const { default: PDFDocument } = await import('pdfkit')
    const pdf = new PDFDocument()
    const chunks = []
    pdf.on('data', (c) => chunks.push(c))
    const done = new Promise((resolve) => pdf.on('end', resolve))
    pdf.text('Just a scanned invoice')
    pdf.end()
    await done

    await expect(parseEInvoice(Buffer.concat(chunks)))
      .rejects.toThrow(/carries no e-invoice data/)
  })

  it('names ZUGFeRD 1.0 rather than complaining about its root element', async () => {
    const v1 = '<rsm:CrossIndustryDocument xmlns:rsm="urn:ferd:CrossIndustryDocument:invoice:1p0"/>'
    await expect(parseEInvoice(await facturXPdf(v1, 'zugferd-invoice.xml')))
      .rejects.toThrow(/ZUGFeRD 1\.0 is not supported/)
    await expect(parseEInvoice(Buffer.from(v1)))
      .rejects.toThrow(/ZUGFeRD 1\.0 is not supported/)
  })

  it('names the national formats it will not import', async () => {
    const cases = [
      ['<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"/>', /FatturaPA/],
      ['<fe:Facturae xmlns:fe="http://www.facturae.es/Facturae/2009/v3.2/Facturae"/>', /Facturae/],
      ['<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/>', /credit note/],
    ]
    for (const [xml, expected] of cases) {
      await expect(parseEInvoice(Buffer.from(xml))).rejects.toThrow(expected)
    }
  })

  it('rejects anything else with a message naming what is supported', async () => {
    await expect(parseEInvoice(Buffer.from('<html><body>nope</body></html>')))
      .rejects.toThrow(/Supported: UBL 2\.1 and UN\/CEFACT CII/)
    await expect(parseEInvoice(Buffer.alloc(0))).rejects.toThrow(EInvoiceParseError)
  })
})
