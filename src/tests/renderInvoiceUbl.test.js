// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { renderInvoiceUbl } from '../../server/utils/renderInvoiceUbl.js'
import { EAS_BY_COUNTRY, EAS_NL_KVK } from '../../shared/peppol.js'

import { NL_TENANT, CASES } from './fixtures/ubl/cases.js'

const render = (name) => renderInvoiceUbl(CASES[name])

// ---------------------------------------------------------------------------
// Parsing helpers — assertions run against the parsed document so they hold for
// any input, not just the goldens.
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
})

// Flattens to nodes carrying a real parent link. Names alone cannot identify a
// node — two InvoiceLines share every ancestor name — so scoping is done by id.
function parse(xml) {
  const out = []
  let nextId = 0

  const visit = (list, parentId, parentName, ancestorNames) => {
    for (const node of list) {
      const name = Object.keys(node).find((key) => key !== ':@')
      if (name === '#text' || name === '?xml') continue
      const children = Array.isArray(node[name]) ? node[name] : []
      const textChild = children.find((child) => '#text' in child)
      const id = nextId++
      out.push({
        id,
        parentId,
        parent: parentName,
        ancestorNames,
        name,
        attrs: node[':@'] ?? {},
        text: textChild ? String(textChild['#text']) : null,
        childCount: children.filter((child) => !('#text' in child)).length,
      })
      visit(children, id, name, [...ancestorNames, name])
    }
  }
  visit(parser.parse(xml), null, null, [])

  const byId = new Map(out.map((n) => [n.id, n]))
  for (const node of out) {
    const chain = []
    for (let p = node.parentId; p !== null; p = byId.get(p).parentId) chain.push(p)
    node.ancestorIds = chain
  }
  return out
}

const nodesNamed = (all, name) => all.filter((n) => n.name === name)
const under = (all, parent, name) => all.filter((n) => n.name === name && n.parent === parent)
/** Every node beneath `node`, however deep. */
const inside = (all, node) => all.filter((n) => n.ancestorIds.includes(node.id))
/** The first descendant of `node` with the given tag name. */
const firstInside = (all, node, name) => inside(all, node).find((n) => n.name === name)

describe.each(Object.keys(CASES))('renderInvoiceUbl — %s', (name) => {
  const xml = render(name)
  const all = parse(xml)

  it('matches the reviewed golden file', () => {
    const golden = readFileSync(resolve(globalThis.process.cwd(), `src/tests/fixtures/ubl/${name}.xml`), 'utf8')
    expect(xml).toBe(golden)
  })

  it('declares the Peppol BIS Billing 3.0 profile (R001/R004/R007)', () => {
    expect(nodesNamed(all, 'cbc:CustomizationID')[0].text)
      .toBe('urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0')
    expect(nodesNamed(all, 'cbc:ProfileID')[0].text)
      .toBe('urn:fdc:peppol.eu:2017:poacc:billing:01:1.0')
  })

  it('contains no empty elements (R008)', () => {
    const empty = all.filter((n) => n.childCount === 0 && (n.text === null || n.text.trim() === ''))
    expect(empty.map((n) => `${n.parent}/${n.name}`)).toEqual([])
  })

  it('carries a buyer reference (R003)', () => {
    expect(nodesNamed(all, 'cbc:BuyerReference')[0].text).toBeTruthy()
  })

  it('has at most one document note (R002)', () => {
    expect(under(all, 'Invoice', 'cbc:Note').length).toBeLessThanOrEqual(1)
  })

  it('states every amount in the document currency (R051/CL007)', () => {
    const currencies = all.map((n) => n.attrs['@_currencyID']).filter(Boolean)
    expect(currencies.length).toBeGreaterThan(0)
    expect([...new Set(currencies)]).toEqual(['EUR'])
  })

  it('has exactly one TaxTotal and it carries subtotals (R053)', () => {
    const totals = under(all, 'Invoice', 'cac:TaxTotal')
    expect(totals).toHaveLength(1)
    expect(nodesNamed(all, 'cac:TaxSubtotal').length).toBeGreaterThan(0)
  })

  it('writes every date as YYYY-MM-DD (F001)', () => {
    for (const n of all.filter((x) => /Date$/.test(x.name))) {
      expect(n.text).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('uses a literal boolean charge indicator and no multiplier (R040-R043)', () => {
    for (const n of nodesNamed(all, 'cbc:ChargeIndicator')) expect(['true', 'false']).toContain(n.text)
    expect(nodesNamed(all, 'cbc:MultiplierFactorNumeric')).toEqual([])
    expect(nodesNamed(all, 'cbc:BaseAmount')).toEqual([])
  })

  it('never states a tax scheme without the VAT identifier (UBL-SR-53)', () => {
    // The group is only meaningful as a carrier for CompanyID. R008 does not
    // catch this: TaxScheme is a constant, so the shell is never fully empty.
    for (const group of nodesNamed(all, 'cac:PartyTaxScheme')) {
      expect(firstInside(all, group, 'cbc:CompanyID')?.text).toBeTruthy()
    }
  })

  it('uses only registered electronic address schemes (CL008)', () => {
    const allowed = new Set([...Object.values(EAS_BY_COUNTRY), EAS_NL_KVK])
    for (const n of nodesNamed(all, 'cbc:EndpointID')) {
      expect(allowed).toContain(n.attrs['@_schemeID'])
    }
  })

  it('reconciles line amounts with quantity x price (R120)', () => {
    for (const line of nodesNamed(all, 'cac:InvoiceLine')) {
      const net = Number(firstInside(all, line, 'cbc:LineExtensionAmount').text)
      const qty = Number(firstInside(all, line, 'cbc:InvoicedQuantity').text)
      const price = Number(firstInside(all, line, 'cbc:PriceAmount').text)
      expect(Math.abs(net - qty * price)).toBeLessThanOrEqual(0.02)
    }
  })

  it('reconciles the monetary totals (BR-CO-10/11/13/15/16)', () => {
    const total = (tag) => {
      const node = under(all, 'cac:LegalMonetaryTotal', tag)[0]
      return node ? Number(node.text) : 0
    }
    const lineSum = nodesNamed(all, 'cac:InvoiceLine')
      .reduce((acc, line) => acc + Number(firstInside(all, line, 'cbc:LineExtensionAmount').text), 0)
    const taxAmount = Number(under(all, 'cac:TaxTotal', 'cbc:TaxAmount')[0].text)

    expect(total('cbc:LineExtensionAmount')).toBeCloseTo(lineSum, 2)
    expect(total('cbc:TaxExclusiveAmount'))
      .toBeCloseTo(total('cbc:LineExtensionAmount') - total('cbc:AllowanceTotalAmount'), 2)
    expect(total('cbc:TaxInclusiveAmount')).toBeCloseTo(total('cbc:TaxExclusiveAmount') + taxAmount, 2)
    expect(total('cbc:PayableAmount')).toBeCloseTo(total('cbc:TaxInclusiveAmount'), 2)
  })

  it('reconciles each VAT breakdown against its lines and allowances (BR-S-08)', () => {
    const percentOf = (node) => firstInside(all, node, 'cbc:Percent')?.text
    const sumFor = (nodes, percent, tag) => nodes
      .filter((node) => percentOf(node) === percent)
      .reduce((acc, node) => acc + Number(firstInside(all, node, tag).text), 0)

    for (const subtotal of nodesNamed(all, 'cac:TaxSubtotal')) {
      const percent = percentOf(subtotal)
      const taxable = Number(firstInside(all, subtotal, 'cbc:TaxableAmount').text)
      const lineNet = sumFor(nodesNamed(all, 'cac:InvoiceLine'), percent, 'cbc:LineExtensionAmount')
      const allowed = sumFor(nodesNamed(all, 'cac:AllowanceCharge'), percent, 'cbc:Amount')
      expect(taxable).toBeCloseTo(lineNet - allowed, 2)
    }
  })

  it('charges no tax on a zero-rated breakdown (BR-Z-09/BR-E-09/BR-AE-09)', () => {
    for (const subtotal of nodesNamed(all, 'cac:TaxSubtotal')) {
      if (Number(firstInside(all, subtotal, 'cbc:Percent').text) !== 0) continue
      expect(Number(firstInside(all, subtotal, 'cbc:TaxAmount').text)).toBe(0)
    }
  })

  it('keeps each category tax within a currency unit of its base (BR-S-09/BR-CO-17)', () => {
    for (const subtotal of nodesNamed(all, 'cac:TaxSubtotal')) {
      const taxable = Number(firstInside(all, subtotal, 'cbc:TaxableAmount').text)
      const tax = Number(firstInside(all, subtotal, 'cbc:TaxAmount').text)
      const percent = Number(firstInside(all, subtotal, 'cbc:Percent').text)
      expect(Math.abs(tax - (taxable * percent) / 100)).toBeLessThan(1)
    }
  })
})

describe('renderInvoiceUbl — VAT categories', () => {
  // The category codes of the VAT breakdown, in document order.
  const breakdownCodes = (all) => nodesNamed(all, 'cac:TaxSubtotal')
    .map((subtotal) => firstInside(all, subtotal, 'cbc:ID').text)

  it('marks a reverse-charge invoice AE with the VATEX code and a reason', () => {
    const all = parse(render('reverse-charge'))
    expect(breakdownCodes(all)).toEqual(['AE'])
    expect(nodesNamed(all, 'cbc:TaxExemptionReasonCode')[0].text).toBe('VATEX-EU-AE')
    // The document language follows the supplier's VAT country, so a Dutch band
    // gets the Dutch note — the same string the PDF prints.
    expect(nodesNamed(all, 'cbc:TaxExemptionReason')[0].text).toBe(
      'Btw verlegd — Reverse charge (Article 196 EU VAT Directive).',
    )
  })

  it('marks a KOR invoice E with free text and NO exemption code', () => {
    // The Dutch small-business scheme has no unambiguous VATEX code; emitting a
    // wrong one would trip PEPPOL-EN16931-P0104..P0111.
    const all = parse(render('kor'))
    expect(breakdownCodes(all)).toEqual(['E'])
    expect(nodesNamed(all, 'cbc:TaxExemptionReasonCode')).toEqual([])
    expect(nodesNamed(all, 'cbc:TaxExemptionReason')[0].text).toBe(
      'Vrijgesteld van btw o.g.v. de kleineondernemersregeling (KOR).',
    )
  })

  it('leaves a standard-rated breakdown with no exemption reason (BR-S-10)', () => {
    const all = parse(render('nl-standard'))
    expect(breakdownCodes(all)).toEqual(['S'])
    expect(nodesNamed(all, 'cbc:TaxExemptionReason')).toEqual([])
  })

  it('splits a discount into one allowance per VAT category', () => {
    const all = parse(render('multi-rate-discount'))
    expect(nodesNamed(all, 'cac:AllowanceCharge')).toHaveLength(2)
    expect(nodesNamed(all, 'cac:TaxSubtotal')).toHaveLength(2)
  })
})

describe('renderInvoiceUbl — electronic addresses', () => {
  it('addresses a Belgian supplier by enterprise number, prefix stripped', () => {
    const endpoint = nodesNamed(parse(render('be-supplier')), 'cbc:EndpointID')[0]
    expect(endpoint.attrs['@_schemeID']).toBe('0208')
    expect(endpoint.text).toBe('0779341748')
    // PEPPOL-COMMON-R043: ten digits passing mod-97.
    expect(endpoint.text).toMatch(/^\d{10}$/)
    expect(Number(endpoint.text.slice(8))).toBe(97 - (Number(endpoint.text.slice(0, 8)) % 97))
  })

  it('qualifies a Dutch legal-entity id with the KVK scheme (NL-R-003/005)', () => {
    const all = parse(render('nl-standard'))
    const ids = under(all, 'cac:PartyLegalEntity', 'cbc:CompanyID')
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(id.attrs['@_schemeID']).toBe('0106')
  })

  it('includes the customer Chamber of Commerce number and VAT ID', () => {
    const all = parse(render('nl-standard'))
    const customerParty = nodesNamed(all, 'cac:AccountingCustomerParty')[0]
    const customerNodes = inside(all, customerParty)
    const legalEntity = customerNodes.find((node) => node.name === 'cac:PartyLegalEntity')
    const taxScheme = customerNodes.find((node) => node.name === 'cac:PartyTaxScheme')

    expect(firstInside(all, legalEntity, 'cbc:CompanyID').text).toBe('87654321')
    expect(firstInside(all, taxScheme, 'cbc:CompanyID').text).toBe('NL819789471B01')
  })

  it('omits the legal-entity id rather than mislabelling a foreign register', () => {
    // Belgian supplier: the number is not a KVK registration, so no CompanyID.
    const all = parse(render('be-supplier'))
    const supplierIds = under(all, 'cac:PartyLegalEntity', 'cbc:CompanyID')
      .filter((n) => n.ancestorNames.includes('cac:AccountingSupplierParty'))
    expect(supplierIds).toEqual([])
  })
})

describe('renderInvoiceUbl — escaping and omissions', () => {
  it('escapes XML metacharacters in free text', () => {
    const xml = renderInvoiceUbl({
      ...CASES['nl-standard'],
      lines: [{ description: 'Rock & Roll <"Live">', quantity: 1, unit_price_cents: 10000, tax_percentage: 21 }],
    })
    expect(xml).toContain('Rock &amp; Roll &lt;&quot;Live&quot;&gt;')
    expect(under(parse(xml), 'cac:Item', 'cbc:Name')[0].text).toBe('Rock & Roll <"Live">')
  })

  it('omits Delivery entirely when there is no supply date', () => {
    const xml = renderInvoiceUbl({
      ...CASES['nl-standard'],
      invoice: { ...CASES['nl-standard'].invoice, supply_date: null },
    })
    expect(xml).not.toContain('cac:Delivery')
  })

  it('states the seller contact when the band publishes one', () => {
    const all = parse(render('de-domestic'))
    const contact = nodesNamed(all, 'cac:Contact')
      .find((n) => n.ancestorNames.includes('cac:AccountingSupplierParty'))
    // Name, Telephone, ElectronicMail — the order UBL requires, and the three
    // elements DE-R-005/006/007 demand.
    expect(inside(all, contact).map((n) => n.name)).toEqual([
      'cbc:Name', 'cbc:Telephone', 'cbc:ElectronicMail',
    ])
    expect(firstInside(all, contact, 'cbc:ElectronicMail').text).toBe('buchung@diewaelder.example')
  })

  it('omits the seller contact entirely when there is no telephone or email', () => {
    // A group carrying nothing but a name would just repeat PartyLegalEntity.
    const all = parse(render('nl-standard'))
    expect(nodesNamed(all, 'cac:Contact')
      .filter((n) => n.ancestorNames.includes('cac:AccountingSupplierParty'))).toEqual([])
  })

  it('omits PaymentMeans when the band has no IBAN', () => {
    const xml = renderInvoiceUbl({
      ...CASES['nl-standard'],
      tenant: { ...NL_TENANT, iban: null },
    })
    expect(xml).not.toContain('cac:PaymentMeans')
  })

  it('drops the whole PartyTaxScheme group when a party has no VAT number', () => {
    const all = parse(render('no-buyer-vat'))
    const groups = nodesNamed(all, 'cac:PartyTaxScheme')
    // Only the supplier's survives; the buyer has no number to state.
    expect(groups).toHaveLength(1)
    expect(groups[0].ancestorNames).toContain('cac:AccountingSupplierParty')
  })

  it('omits the buyer EndpointID when nothing identifies the customer', () => {
    const xml = renderInvoiceUbl({
      ...CASES['nl-standard'],
      invoice: { ...CASES['nl-standard'].invoice, customer_tax_id: null, customer_kvk: null },
    })
    const endpoints = nodesNamed(parse(xml), 'cbc:EndpointID')
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0].ancestorNames).toContain('cac:AccountingSupplierParty')
    // The document is still produced — the warning channel tells the user why.
    expect(xml).toContain('cac:AccountingCustomerParty')
  })

  it('falls back to the invoice number as buyer reference with no linked gig', () => {
    const xml = renderInvoiceUbl({
      ...CASES['nl-standard'],
      invoice: { ...CASES['nl-standard'].invoice, event_description: null },
    })
    expect(nodesNamed(parse(xml), 'cbc:BuyerReference')[0].text).toBe('2026-0007')
  })
})

describe('renderInvoiceUbl — embedded PDF', () => {
  it('embeds the rendered invoice PDF as a Peppol supporting document', () => {
    const pdf = Buffer.from('%PDF-1.7 invoice')
    const all = parse(renderInvoiceUbl({
      ...CASES['nl-standard'],
      embeddedPdf: {
        filename: 'factuur-2026-0007.pdf',
        base64: pdf.toString('base64'),
      },
    }))

    const reference = nodesNamed(all, 'cac:AdditionalDocumentReference')[0]
    const binary = firstInside(all, reference, 'cbc:EmbeddedDocumentBinaryObject')
    expect(firstInside(all, reference, 'cbc:ID').text).toBe('factuur-2026-0007.pdf')
    expect(binary.attrs).toMatchObject({
      '@_mimeCode': 'application/pdf',
      '@_filename': 'factuur-2026-0007.pdf',
    })
    expect(Buffer.from(binary.text, 'base64')).toEqual(pdf)
  })

  it('adds one notice when PDF rendering failed and preserves the invoice memo', () => {
    const all = parse(renderInvoiceUbl({
      ...CASES['nl-standard'],
      invoice: { ...CASES['nl-standard'].invoice, memo: 'Existing invoice memo.' },
      embeddedPdf: null,
    }))

    expect(nodesNamed(all, 'cac:AdditionalDocumentReference')).toEqual([])
    const notes = under(all, 'Invoice', 'cbc:Note')
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toContain('Existing invoice memo.')
    expect(notes[0].text).toContain('pdf kon niet worden gemaakt')
  })
})
