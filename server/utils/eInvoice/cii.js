// Reads a UN/CEFACT Cross Industry Invoice (CII D16B) into the same normalized
// document ubl.js produces. Pure: no DB, no IO.
//
// CII is the OTHER syntax EN 16931 permits. Same business terms, different tree:
// where UBL nests everything under Invoice, CII splits a document into
// ExchangedDocument (the header) and SupplyChainTradeTransaction, which in turn
// separates Agreement (who), Delivery (when) and Settlement (money). Reading it
// is therefore a different walk to the same destination — which is why both
// readers share nodes.js and return one shape, and why nothing downstream of
// this directory knows which syntax a purchase came from.
//
// This is what makes Germany and France work: XRechnung may be sent as CII, and
// Factur-X / ZUGFeRD 2.x are CII carried inside a PDF (see facturx.js).
//
// THREE DIFFERENCES FROM UBL THAT MATTER:
//
//  1. Dates are YYYYMMDD (udt:DateTimeString format="102"), not ISO.
//  2. Amounts carry no per-amount currencyID — the currency is stated once, in
//     InvoiceCurrencyCode — so there is no mixed-currency check to make here.
//     ubl.js can and does verify that; this reader has nothing to verify.
//  3. A credit note is NOT a different root element, only TypeCode 381 in the
//     same envelope. The mandatory BT-3 check is the only thing standing
//     between a credit note and being booked as a bill.
import { normalizeIban } from '../normalizeIban.js'
import {
  CREDIT_NOTE_TYPE_CODES,
  VAT_CATEGORY,
  ZERO_RATED_VAT_CATEGORIES,
  isRealCalendarDate,
  parseUblAmount,
  resolvePostalCountry,
  toUblDate,
} from '../../../shared/peppol.js'
import {
  EInvoiceParseError,
  asArray,
  assertRootElement,
  attr,
  createParser,
  numberOf,
  readRootElement,
  required,
  text,
  trimOrNull,
} from './nodes.js'

export const CII_NS = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100'

const parser = createParser([
  'IncludedSupplyChainTradeLineItem', 'SpecifiedTradeAllowanceCharge',
  'ApplicableTradeTax', 'SpecifiedTradeSettlementPaymentMeans',
  'SpecifiedTaxRegistration', 'IncludedNote', 'AdditionalReferencedDocument',
  'SpecifiedTradePaymentTerms',
])

const amountOf = (v) => parseUblAmount(text(v))

// udt:DateTimeString, qualified by a format attribute: 102 is YYYYMMDD, which is
// all EN 16931 uses. Anything else (610 = YYYYMM, 616 = week) is not a calendar
// date and is refused rather than guessed into one.
function ciiDate(node) {
  const value = trimOrNull(node?.DateTimeString) ?? trimOrNull(node)
  if (!value) return null
  const format = attr(node?.DateTimeString, 'format')
  if (format && format !== '102') return null

  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  // The shape is not enough: 20260231 matches it and is not a day.
  if (match && isRealCalendarDate(match[1], match[2], match[3])) {
    return `${match[1]}-${match[2]}-${match[3]}`
  }
  // Some senders write an ISO date despite the format code. toUblDate applies
  // the same calendar check, so this path cannot be the lenient one.
  return match ? null : toUblDate(value)
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

// BT-31/BT-48. SpecifiedTaxRegistration/ID is qualified by schemeID: VA is the
// VAT number, FC a national tax registration. Falls back to the sole
// registration when none names its scheme.
function vatIdOf(party) {
  const registrations = asArray(party?.SpecifiedTaxRegistration)
  const vat = registrations.find((r) => attr(r?.ID, 'schemeID')?.toUpperCase() === 'VA')
  return trimOrNull((vat ?? (registrations.length === 1 ? registrations[0] : null))?.ID)
}

function partyOf(party) {
  if (!party) return null
  const address = party.PostalTradeAddress
  return {
    name: trimOrNull(party.Name) ?? trimOrNull(party.SpecifiedLegalOrganization?.TradingBusinessName) ?? null,
    vatId: vatIdOf(party),
    // BT-30/BT-47, the legal registration number (Handelsregister, SIREN, KVK).
    registrationId: trimOrNull(party.SpecifiedLegalOrganization?.ID),
    endpointId: trimOrNull(party.URIUniversalCommunication?.URIID),
    email: trimOrNull(party.DefinedTradeContact?.EmailURIUniversalCommunication?.URIID),
    country: resolvePostalCountry(trimOrNull(address?.CountryID)),
    street: trimOrNull(address?.LineOne),
    postalCode: trimOrNull(address?.PostcodeCode),
    city: trimOrNull(address?.CityName),
  }
}

// ---------------------------------------------------------------------------
// VAT categories
// ---------------------------------------------------------------------------

// A ram:ApplicableTradeTax / ram:CategoryTradeTax → { code, percent }.
// Zero-rated categories are normalized to 0 for the same reason as in UBL: a
// document stating a rate on an exempt line would otherwise invent VAT.
function categoryOf(node) {
  if (!node) return null
  const code = trimOrNull(node.CategoryCode)?.toUpperCase() ?? null
  const percent = numberOf(node.RateApplicablePercent)
  if (code && ZERO_RATED_VAT_CATEGORIES.has(code)) return { code, percent: 0 }
  if (percent === null) return code ? { code, percent: null } : null
  return { code: code ?? (percent > 0 ? VAT_CATEGORY.STANDARD : VAT_CATEGORY.ZERO), percent }
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

// LineTotalAmount (BT-131) is the line net, already reduced by any line-level
// allowance — the same semantics as UBL's LineExtensionAmount.
function lineOf(item, index) {
  const settlement = item.SpecifiedLineTradeSettlement
  const netCents = amountOf(settlement?.SpecifiedTradeSettlementLineMonetarySummation?.LineTotalAmount)
  if (netCents === null) {
    throw new EInvoiceParseError(`invoice line ${index + 1} has no readable LineTotalAmount`)
  }
  const product = item.SpecifiedTradeProduct
  const quantity = item.SpecifiedLineTradeDelivery?.BilledQuantity
  return {
    id: trimOrNull(item.AssociatedDocumentLineDocument?.LineID) ?? String(index + 1),
    description: trimOrNull(product?.Name) ?? trimOrNull(product?.Description)
      ?? trimOrNull(product?.SellerAssignedID) ?? null,
    quantity: numberOf(quantity),
    unitCode: attr(quantity, 'unitCode'),
    netCents,
    category: categoryOf(asArray(settlement?.ApplicableTradeTax)[0]),
  }
}

// ---------------------------------------------------------------------------
// Document-level allowances and charges
// ---------------------------------------------------------------------------

// BG-20/BG-21. ChargeIndicator wraps its boolean one level deeper than UBL, in
// udt:Indicator.
function allowanceChargesOf(settlement) {
  const result = []
  for (const node of asArray(settlement?.SpecifiedTradeAllowanceCharge)) {
    const cents = amountOf(node.ActualAmount)
    if (cents === null || cents === 0) continue
    const isCharge = trimOrNull(node.ChargeIndicator?.Indicator)?.toLowerCase() === 'true'
    const raisesTotal = cents < 0 ? !isCharge : isCharge
    result.push({
      kind: raisesTotal ? 'charge' : 'allowance',
      cents: Math.abs(cents),
      reason: trimOrNull(node.Reason),
      category: categoryOf(node.CategoryTradeTax),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

// BG-23. BasisAmount is the taxable base, CalculatedAmount the VAT on it.
function vatBreakdownOf(settlement) {
  return asArray(settlement?.ApplicableTradeTax).map((tax) => ({
    taxableCents: amountOf(tax.BasisAmount),
    taxCents: amountOf(tax.CalculatedAmount),
    category: categoryOf(tax),
  }))
}

// BT-110. Like UBL's second TaxTotal, a document may state the tax total twice —
// once in the invoice currency and once in the seller's local tax currency
// (BT-111), distinguished by currencyID. Prefer the invoice currency.
function documentTaxCents(summation, currency) {
  const stated = asArray(summation?.TaxTotalAmount)
  const inDocCurrency = stated.find((a) => attr(a, 'currencyID')?.toUpperCase() === currency)
  return amountOf(inDocCurrency ?? stated[0])
}

// The CII names differ from UBL's for the same business terms:
//   LineTotalAmount     BT-106  = UBL LineExtensionAmount
//   TaxBasisTotalAmount BT-109  = UBL TaxExclusiveAmount
//   GrandTotalAmount    BT-112  = UBL TaxInclusiveAmount
//   DuePayableAmount    BT-115  = UBL PayableAmount
function totalsOf(summation, currency) {
  return {
    lineExtensionCents: amountOf(summation?.LineTotalAmount),
    taxExclusiveCents: amountOf(summation?.TaxBasisTotalAmount),
    taxInclusiveCents: amountOf(summation?.GrandTotalAmount),
    allowanceTotalCents: amountOf(summation?.AllowanceTotalAmount) ?? 0,
    chargeTotalCents: amountOf(summation?.ChargeTotalAmount) ?? 0,
    prepaidCents: amountOf(summation?.TotalPrepaidAmount) ?? 0,
    roundingCents: amountOf(summation?.RoundingAmount) ?? 0,
    payableCents: amountOf(summation?.DuePayableAmount),
    taxCents: documentTaxCents(summation, currency),
  }
}

// ---------------------------------------------------------------------------
// Attachments and payment
// ---------------------------------------------------------------------------

// BT-125, the same embedded-binary rule as UBL: only what the document carries
// itself. An external URI is never followed.
function attachmentsOf(agreement, invoiceNumber) {
  const result = []
  for (const [i, ref] of asArray(agreement?.AdditionalReferencedDocument).entries()) {
    const embedded = ref?.AttachmentBinaryObject
    const base64 = trimOrNull(embedded)
    if (!base64) continue
    result.push({
      mimeCode: attr(embedded, 'mimeCode'),
      filename: attr(embedded, 'filename')
        ?? `${trimOrNull(ref.IssuerAssignedID) ?? invoiceNumber ?? 'attachment'}${i > 0 ? `-${i + 1}` : ''}.pdf`,
      bytes: Buffer.from(base64, 'base64'),
    })
  }
  return result
}

function payeeIbanOf(settlement) {
  for (const means of asArray(settlement?.SpecifiedTradeSettlementPaymentMeans)) {
    const account = means?.PayeePartyCreditorFinancialAccount
    const iban = normalizeIban(trimOrNull(account?.IBANID) ?? trimOrNull(account?.ProprietaryID))
    if (iban) return iban
  }
  return null
}

function dueDateOf(settlement) {
  for (const terms of asArray(settlement?.SpecifiedTradePaymentTerms)) {
    const due = ciiDate(terms?.DueDateDateTime)
    if (due) return due
  }
  return null
}

// ---------------------------------------------------------------------------

/**
 * @param {string} xml
 * @returns {object} the normalized document (see ubl.js for the same shape)
 * @throws {EInvoiceParseError}
 */
export function parseCiiInvoice(xml) {
  assertRootElement(readRootElement(xml), {
    localName: 'CrossIndustryInvoice', namespace: CII_NS, syntax: 'CII invoice',
  })

  let doc
  try {
    doc = parser.parse(xml)
  } catch (err) {
    throw new EInvoiceParseError(`invalid XML: ${err.message}`)
  }

  const root = doc?.CrossIndustryInvoice
  if (!root) throw new EInvoiceParseError('not a CII invoice document')

  const header = root.ExchangedDocument
  const transaction = root.SupplyChainTradeTransaction
  const agreement = transaction?.ApplicableHeaderTradeAgreement
  const settlement = transaction?.ApplicableHeaderTradeSettlement
  const summation = settlement?.SpecifiedTradeSettlementHeaderMonetarySummation

  // In CII the type code is the ONLY thing separating an invoice from a credit
  // note — there is no second root element to fall back on.
  const typeCode = required(trimOrNull(header?.TypeCode), 'BT-3', 'an invoice type code')
  if (CREDIT_NOTE_TYPE_CODES.has(typeCode)) {
    throw new EInvoiceParseError(`document type ${typeCode} is a credit note and cannot be imported as a purchase`)
  }

  const invoiceNumber = required(trimOrNull(header?.ID), 'BT-1', 'an invoice number')
  const currency = required(
    trimOrNull(settlement?.InvoiceCurrencyCode)?.toUpperCase(), 'BT-5', 'a document currency',
  )
  const issueDate = required(ciiDate(header?.IssueDateTime), 'BT-2', 'a valid issue date')

  const totals = totalsOf(summation, currency)
  if (totals.taxInclusiveCents === null && totals.payableCents === null) {
    throw new EInvoiceParseError('invoice states no total amount (BT-112 / BT-115)')
  }

  return {
    syntax: 'cii',
    invoiceNumber,
    typeCode,
    // BT-24. Names the Factur-X/ZUGFeRD profile, which is how the caller knows a
    // line-less MINIMUM or BASIC WL document is a summary rather than a defect.
    customizationId: trimOrNull(root.ExchangedDocumentContext
      ?.GuidelineSpecifiedDocumentContextParameter?.ID),
    issueDate,
    dueDate: dueDateOf(settlement),
    currency,
    note: asArray(header?.IncludedNote).map((n) => trimOrNull(n?.Content)).filter(Boolean).join('\n') || null,
    buyerReference: trimOrNull(agreement?.BuyerReference),
    orderReference: trimOrNull(agreement?.BuyerOrderReferencedDocument?.IssuerAssignedID),
    supplier: partyOf(agreement?.SellerTradeParty),
    customer: partyOf(agreement?.BuyerTradeParty),
    payeeIban: payeeIbanOf(settlement),
    lines: asArray(transaction?.IncludedSupplyChainTradeLineItem).map((line) => lineOf(line)),
    allowanceCharges: allowanceChargesOf(settlement),
    vatBreakdown: vatBreakdownOf(settlement),
    totals,
    attachments: attachmentsOf(agreement, invoiceNumber),
  }
}
