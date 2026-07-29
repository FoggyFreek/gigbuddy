// Reads a UBL 2.1 Invoice into a normalized document. The mirror image of
// renderInvoiceUbl.js: both sides share the EN 16931 code lists and the
// amount <-> cents primitives in shared/peppol.js, so a code only one direction
// knows about cannot exist.
//
// Pure: no DB, no IO. Mapping the result onto a purchase is the service's job
// (server/services/purchaseImportService.js).
//
// TOLERANT BY DESIGN, WITHIN LIMITS. Incoming invoices come from whatever the
// supplier runs — Peppol BIS Billing 3.0, the older SI-UBL 1.2 still common in
// the Dutch market, or something between. So every field EN 16931 marks optional
// has a fallback chain (a line's VAT rate, for one, lives in ClassifiedTaxCategory
// in BIS 3.0 but only in the line's own TaxTotal in SI-UBL 1.2), and the stated
// document totals are read rather than recomputed: they are what the supplier
// is charging, and a document whose own totals disagree with its lines is
// something the user must see, not something to quietly re-derive.
//
// What it refuses outright: anything that is not a UBL Invoice, and credit
// notes. A credit note's amounts mean the opposite of an invoice's, and booking
// one as a positive expense is a real accounting error rather than a rounding
// one.
import { XMLParser } from 'fast-xml-parser'
import { normalizeIban } from './normalizeIban.js'
import {
  CREDIT_NOTE_TYPE_CODES,
  VAT_CATEGORY,
  ZERO_RATED_VAT_CATEGORIES,
  parseUblAmount,
  resolvePostalCountry,
  toUblDate,
} from '../../shared/peppol.js'

export class UblParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UblParseError'
  }
}

// removeNSPrefix strips cbc:/cac: so a document using default namespaces parses
// identically. parseTagValue stays off: every value is read through an explicit
// converter, and numeric coercion would reshape amounts and strip leading zeros
// from identifiers.
const REPEATABLE = new Set([
  'InvoiceLine', 'AllowanceCharge', 'TaxTotal', 'TaxSubtotal',
  'AdditionalDocumentReference', 'PaymentMeans', 'PartyTaxScheme', 'Note',
])
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => REPEATABLE.has(name),
})

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
// A UBL element is either a bare string or { '#text': …, '@_attr': … }.
const text = (v) => (v && typeof v === 'object' ? v['#text'] : v)
const trimOrNull = (v) => {
  const t = text(v)
  return t == null || String(t).trim() === '' ? null : String(t).trim()
}
const attr = (v, name) => (v && typeof v === 'object' ? trimOrNull(v[`@_${name}`]) : null)
const amountOf = (v) => parseUblAmount(text(v))
const numberOf = (v) => {
  const n = Number(trimOrNull(v))
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

// The VAT identifier (BT-31/BT-48): the PartyTaxScheme whose scheme is VAT.
// A party may state several (VAT plus a national scheme such as NL:OB), so the
// scheme is matched rather than the first group taken. Falls back to the sole
// group when none names its scheme.
function vatIdOf(party) {
  const groups = asArray(party?.PartyTaxScheme)
  const vatGroup = groups.find((g) => trimOrNull(g?.TaxScheme?.ID)?.toUpperCase() === 'VAT')
  return trimOrNull((vatGroup ?? (groups.length === 1 ? groups[0] : null))?.CompanyID)
}

function partyOf(node) {
  const party = node?.Party
  if (!party) return null
  const address = party.PostalAddress
  return {
    // BT-27/BT-44 is the registered name; the trading name is the fallback.
    name: trimOrNull(party.PartyLegalEntity?.RegistrationName)
      ?? trimOrNull(party.PartyName?.Name)
      ?? null,
    vatId: vatIdOf(party),
    registrationId: trimOrNull(party.PartyLegalEntity?.CompanyID),
    endpointId: trimOrNull(party.EndpointID),
    email: trimOrNull(party.Contact?.ElectronicMail),
    country: resolvePostalCountry(trimOrNull(address?.Country?.IdentificationCode)),
    street: trimOrNull(address?.StreetName),
    postalCode: trimOrNull(address?.PostalZone),
    city: trimOrNull(address?.CityName),
  }
}

// ---------------------------------------------------------------------------
// VAT categories
// ---------------------------------------------------------------------------

// A cac:TaxCategory / cac:ClassifiedTaxCategory → { code, percent }.
//
// A zero-rated category's Percent is normalized to 0 whatever it states: BR-Z-05
// and friends require 0 there, but documents in the wild have been seen carrying
// the standard rate on an exempt line, and trusting that would invent VAT.
function categoryOf(node) {
  if (!node) return null
  const code = trimOrNull(node.ID)?.toUpperCase() ?? null
  const percent = numberOf(node.Percent)
  if (code && ZERO_RATED_VAT_CATEGORIES.has(code)) return { code, percent: 0 }
  if (percent === null) return code ? { code, percent: null } : null
  return { code: code ?? (percent > 0 ? VAT_CATEGORY.STANDARD : VAT_CATEGORY.ZERO), percent }
}

// The first TaxCategory reachable through a node's own TaxTotal/TaxSubtotal.
// This is where SI-UBL 1.2 puts a line's rate — it has no ClassifiedTaxCategory.
function categoryFromTaxTotals(node) {
  for (const total of asArray(node?.TaxTotal)) {
    for (const subtotal of asArray(total?.TaxSubtotal)) {
      const category = categoryOf(subtotal?.TaxCategory)
      if (category) return category
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

// BT-153 is the item name; BT-154 the longer description. Both are optional, so
// fall back to the seller's item identifier and finally the line id, because a
// purchase line with no description at all cannot be approved.
function descriptionOf(line) {
  return trimOrNull(line.Item?.Name)
    ?? trimOrNull(line.Item?.Description)
    ?? trimOrNull(line.Item?.SellersItemIdentification?.ID)
    ?? null
}

// LineExtensionAmount (BT-131) is already net of any line-level allowance or
// charge per BR-24, so those are not applied again here.
function lineOf(line, index) {
  const netCents = amountOf(line.LineExtensionAmount)
  if (netCents === null) {
    throw new UblParseError(`invoice line ${index + 1} has no readable LineExtensionAmount`)
  }
  return {
    id: trimOrNull(line.ID) ?? String(index + 1),
    description: descriptionOf(line),
    quantity: numberOf(line.InvoicedQuantity),
    unitCode: attr(line.InvoicedQuantity, 'unitCode'),
    netCents,
    category: categoryOf(line.Item?.ClassifiedTaxCategory) ?? categoryFromTaxTotals(line),
  }
}

// ---------------------------------------------------------------------------
// Document-level allowances and charges
// ---------------------------------------------------------------------------

// BG-20/BG-21. ChargeIndicator false = allowance (a discount), true = charge.
// Both are returned positive, tagged by kind, and carrying the VAT category they
// apply to so the importer can allocate each to the lines it actually affects.
function allowanceChargesOf(doc) {
  const result = []
  for (const node of asArray(doc.AllowanceCharge)) {
    const cents = amountOf(node.Amount)
    if (cents === null || cents === 0) continue
    const isCharge = trimOrNull(node.ChargeIndicator)?.toLowerCase() === 'true'
    // A negative amount reverses the indicator; normalize the sign away so
    // `kind` is the only thing carrying direction.
    const raisesTotal = cents < 0 ? !isCharge : isCharge
    result.push({
      kind: raisesTotal ? 'charge' : 'allowance',
      cents: Math.abs(cents),
      reason: trimOrNull(node.AllowanceChargeReason),
      category: categoryOf(node.TaxCategory),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

// BT-110. A document may carry a second TaxTotal in the seller's local tax
// currency (BT-111); pick the one stated in the document currency.
function documentTaxCents(doc, currency) {
  const totals = asArray(doc.TaxTotal)
  if (!totals.length) return null
  const inDocCurrency = totals.find((t) => attr(t.TaxAmount, 'currencyID') === currency)
  return amountOf((inDocCurrency ?? totals[0]).TaxAmount)
}

function vatBreakdownOf(doc, currency) {
  const totals = asArray(doc.TaxTotal)
  const inDocCurrency = totals.find((t) => attr(t.TaxAmount, 'currencyID') === currency) ?? totals[0]
  return asArray(inDocCurrency?.TaxSubtotal).map((subtotal) => ({
    taxableCents: amountOf(subtotal.TaxableAmount),
    taxCents: amountOf(subtotal.TaxAmount),
    category: categoryOf(subtotal.TaxCategory),
  }))
}

function totalsOf(doc, currency) {
  const monetary = doc.LegalMonetaryTotal ?? {}
  return {
    lineExtensionCents: amountOf(monetary.LineExtensionAmount),
    taxExclusiveCents: amountOf(monetary.TaxExclusiveAmount),
    taxInclusiveCents: amountOf(monetary.TaxInclusiveAmount),
    allowanceTotalCents: amountOf(monetary.AllowanceTotalAmount) ?? 0,
    chargeTotalCents: amountOf(monetary.ChargeTotalAmount) ?? 0,
    prepaidCents: amountOf(monetary.PrepaidAmount) ?? 0,
    roundingCents: amountOf(monetary.PayableRoundingAmount) ?? 0,
    payableCents: amountOf(monetary.PayableAmount),
    taxCents: documentTaxCents(doc, currency),
  }
}

// ---------------------------------------------------------------------------
// Attachments and payment
// ---------------------------------------------------------------------------

// Embedded binary objects only (BT-125). cac:ExternalReference/cbc:URI is
// deliberately ignored: following a URL out of an uploaded document would let
// the sender choose what this server requests.
function attachmentsOf(doc, invoiceNumber) {
  const result = []
  for (const [i, ref] of asArray(doc.AdditionalDocumentReference).entries()) {
    const embedded = ref?.Attachment?.EmbeddedDocumentBinaryObject
    const base64 = trimOrNull(embedded)
    if (!base64) continue
    const mimeCode = attr(embedded, 'mimeCode')
    result.push({
      mimeCode,
      filename: attr(embedded, 'filename')
        ?? `${trimOrNull(ref.ID) ?? invoiceNumber ?? 'attachment'}${i > 0 ? `-${i + 1}` : ''}.pdf`,
      bytes: Buffer.from(base64, 'base64'),
    })
  }
  return result
}

// BT-84 across every stated payment means, first non-empty wins.
function payeeIbanOf(doc) {
  for (const means of asArray(doc.PaymentMeans)) {
    const iban = normalizeIban(trimOrNull(means?.PayeeFinancialAccount?.ID))
    if (iban) return iban
  }
  return null
}

// BT-9. SI-UBL 1.2 states it as PaymentMeans/PaymentDueDate instead.
function dueDateOf(doc) {
  const stated = toUblDate(trimOrNull(doc.DueDate))
  if (stated) return stated
  for (const means of asArray(doc.PaymentMeans)) {
    const fromMeans = toUblDate(trimOrNull(means?.PaymentDueDate))
    if (fromMeans) return fromMeans
  }
  return null
}

// ---------------------------------------------------------------------------
// Document identity
// ---------------------------------------------------------------------------

const UBL_INVOICE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'

const XML_COMMENTS = /<!--[\s\S]*?-->/g
const XML_PROLOG = /<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g
const FIRST_ELEMENT = /<([A-Za-z_][\w.-]*)(?::([A-Za-z_][\w.-]*))?((?:\s+[^>]*)?)>/

// removeNSPrefix makes `<x:Invoice xmlns:x="urn:anything">` parse as `Invoice`,
// so the parsed tree cannot tell a UBL invoice from any other document with a
// root of that name — it drops the xmlns declarations entirely. The raw root tag
// is therefore the only place the namespace can still be checked.
function assertUblInvoiceNamespace(xml) {
  const head = xml.replace(XML_COMMENTS, '').replace(XML_PROLOG, '')
  const match = FIRST_ELEMENT.exec(head)
  if (!match) throw new UblParseError('not a UBL Invoice document')

  const [, first, second, attrs] = match
  const prefix = second ? first : null
  const localName = second ?? first
  if (localName === 'CreditNote') {
    throw new UblParseError('credit notes cannot be imported as a purchase')
  }
  if (localName !== 'Invoice') throw new UblParseError('not a UBL Invoice document')

  const declaration = prefix
    ? new RegExp(`\\sxmlns:${prefix}\\s*=\\s*["']([^"']*)["']`)
    : /\sxmlns\s*=\s*["']([^"']*)["']/
  if (declaration.exec(attrs)?.[1] !== UBL_INVOICE_NS) {
    throw new UblParseError(`root element is not in the UBL Invoice namespace (${UBL_INVOICE_NS})`)
  }
}

// Every amount this parser READS must be stated in the document currency.
//
// currencyID is per-amount in UBL, so a document can declare EUR and then state
// a line in another currency; BR-CO-25 and friends forbid it, but a document we
// did not write is not a document we can assume is conformant. The one
// legitimate exception is a second TaxTotal in the seller's local tax currency
// (BT-111), which is why the TaxTotal picked for reading is selected by
// currency rather than checked here.
function assertOneCurrency(invoice, currency) {
  const monetary = invoice.LegalMonetaryTotal ?? {}
  const amounts = [
    ...Object.values(monetary),
    ...asArray(invoice.InvoiceLine).map((line) => line?.LineExtensionAmount),
    ...asArray(invoice.AllowanceCharge).map((node) => node?.Amount),
  ]
  for (const amount of amounts) {
    const stated = attr(amount, 'currencyID')
    if (stated && stated.toUpperCase() !== currency) {
      throw new UblParseError(
        `invoice mixes currencies: ${stated.toUpperCase()} stated on an amount in a ${currency} document`,
      )
    }
  }
}

// A mandatory field is one EN 16931 marks as such AND that changes how the bill
// is booked. Defaulting any of these would put a guess into the ledger: a
// missing issue date silently becomes the wrong VAT period, an unreadable total
// removes the only cross-check on the lines.
function required(value, term, name) {
  if (value === null || value === undefined || value === '') {
    throw new UblParseError(`invoice is missing ${name} (${term})`)
  }
  return value
}

/**
 * @param {string} xml
 * @returns {object} the normalized document — see the mapping in
 *   purchaseImportService.js for how each part is consumed.
 * @throws {UblParseError}
 */
export function parseUblInvoice(xml) {
  assertUblInvoiceNamespace(String(xml ?? ''))

  let doc
  try {
    doc = parser.parse(xml)
  } catch (err) {
    throw new UblParseError(`invalid XML: ${err.message}`)
  }

  if (doc?.CreditNote) throw new UblParseError('credit notes cannot be imported as a purchase')
  const invoice = doc?.Invoice
  if (!invoice) throw new UblParseError('not a UBL Invoice document')

  // BT-3 decides what the document IS. Accepting one that states nothing means
  // accepting a credit note that simply forgot to say so.
  const typeCode = required(trimOrNull(invoice.InvoiceTypeCode), 'BT-3', 'an invoice type code')
  if (CREDIT_NOTE_TYPE_CODES.has(typeCode)) {
    throw new UblParseError(`document type ${typeCode} is a credit note and cannot be imported as a purchase`)
  }

  const invoiceNumber = required(trimOrNull(invoice.ID), 'BT-1', 'an invoice number')
  // BT-5, falling back to the currency the totals are stated in. Never defaulted:
  // "no currency stated" must not read as "safe to book as EUR".
  const currency = required((trimOrNull(invoice.DocumentCurrencyCode)
    ?? attr(invoice.LegalMonetaryTotal?.PayableAmount, 'currencyID')
    ?? attr(invoice.LegalMonetaryTotal?.TaxInclusiveAmount, 'currencyID')
  )?.toUpperCase(), 'BT-5', 'a document currency')
  const issueDate = required(toUblDate(trimOrNull(invoice.IssueDate)), 'BT-2', 'a valid issue date')

  const lines = asArray(invoice.InvoiceLine).map(lineOf)
  if (!lines.length) throw new UblParseError('invoice has no invoice lines')

  const totals = totalsOf(invoice, currency)
  // BT-112/BT-115. Without one of these the lines have nothing to reconcile
  // against, and a silent import is exactly the case where that matters most.
  if (totals.taxInclusiveCents === null && totals.payableCents === null) {
    throw new UblParseError('invoice states no total amount (BT-112 / BT-115)')
  }
  assertOneCurrency(invoice, currency)

  return {
    invoiceNumber,
    typeCode,
    customizationId: trimOrNull(invoice.CustomizationID),
    issueDate,
    dueDate: dueDateOf(invoice),
    currency,
    // BT-22 may repeat; keep them all as one note, which is where the purchase
    // memo comes from.
    note: asArray(invoice.Note).map(trimOrNull).filter(Boolean).join('\n') || null,
    buyerReference: trimOrNull(invoice.BuyerReference),
    orderReference: trimOrNull(invoice.OrderReference?.ID),
    supplier: partyOf(invoice.AccountingSupplierParty),
    customer: partyOf(invoice.AccountingCustomerParty),
    payeeIban: payeeIbanOf(invoice),
    lines,
    allowanceCharges: allowanceChargesOf(invoice),
    vatBreakdown: vatBreakdownOf(invoice, currency),
    totals,
    attachments: attachmentsOf(invoice, invoiceNumber),
  }
}
