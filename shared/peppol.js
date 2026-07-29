// Peppol BIS Billing 3.0 / EN 16931 code lists and formatting primitives,
// shared so the backend can render the UBL document and the frontend can warn
// about the same gaps before the user downloads it.
//
// Scope is deliberately narrow: the invoices GigBuddy actually issues, in the
// VAT countries it supports. No credit notes, no charges, no foreign currency.
import { normalizeVatNumber, normalizeVatCountry, isValidVatId } from './vatRates.js'

// ---------------------------------------------------------------------------
// EN 16931 / UBL code lists
//
// One owner for the codes, because they are read in both directions: the
// renderer writes them (server/utils/renderInvoiceUbl.js) and the importer
// matches on them (server/utils/parseUblInvoice.js). A code that only one side
// knows is how the two drift apart.
// ---------------------------------------------------------------------------

/** UNCL1001 — a commercial invoice, the only document type GigBuddy issues. */
export const INVOICE_TYPE_COMMERCIAL = '380'

// UNCL1001 codes that reverse a charge rather than raise one. A UBL Invoice
// carrying one of these is a credit note in an Invoice envelope: its amounts
// mean the opposite of what a purchase expects, so the importer refuses it
// rather than booking a negative expense as a positive one.
export const CREDIT_NOTE_TYPE_CODES = Object.freeze(new Set(['381', '396', '81', '83', '261', '262']))

/** UNCL5305 VAT category codes (BT-95/BT-102/BT-118). */
export const VAT_CATEGORY = Object.freeze({
  STANDARD: 'S',
  ZERO: 'Z',
  EXEMPT: 'E',
  REVERSE_CHARGE: 'AE',
  OUTSIDE_SCOPE: 'O',
  INTRA_COMMUNITY: 'K',
  EXPORT: 'G',
})

/** Categories that carry no VAT, whatever Percent the document states. */
export const ZERO_RATED_VAT_CATEGORIES = Object.freeze(new Set([
  VAT_CATEGORY.ZERO,
  VAT_CATEGORY.EXEMPT,
  VAT_CATEGORY.REVERSE_CHARGE,
  VAT_CATEGORY.OUTSIDE_SCOPE,
  VAT_CATEGORY.INTRA_COMMUNITY,
  VAT_CATEGORY.EXPORT,
]))

/** UNCL4461 — SEPA credit transfer (BT-81). */
export const PAYMENT_MEANS_CREDIT_TRANSFER = '30'

/** UNCL5189 "Discount" — the reason code on a document-level allowance (BT-98). */
export const DISCOUNT_REASON_CODE = '95'

/** UN/ECE Rec 20 — the unit for a service with no measure (BT-130). */
export const UNIT_ONE = 'C62'

// Electronic Address Scheme per supported country (Peppol EAS code list).
// All VAT-number based except Belgium — Belgian participants are registered
// under their enterprise (CBE) number, and a VAT registration is only an extra
// voluntary identifier, so 0208 is the one that actually routes.
// Note `at` is 9914 (UID); 9915 is the Austrian administrative identifier.
export const EAS_BY_COUNTRY = Object.freeze({
  nl: '9944',
  be: '0208',
  de: '9930',
  fr: '9957',
  lu: '9938',
  at: '9914',
  es: '9920',
  it: '0211',
  ie: '9935',
  gb: '9932',
})

// Dutch Chamber of Commerce (KVK) number scheme — the fallback electronic
// address for an NL party we have no VAT number for.
export const EAS_NL_KVK = '0106'

// The electronic address (BT-34 / BT-49) for a party, or null when nothing we
// hold identifies them. `country` is the party's TAX jurisdiction, not its
// postal country: the scheme says which register the identifier lives in.
//
// This is inference, not a lookup — holding a VAT number does not prove the
// party registered that identifier as a Peppol participant. Callers surface
// that caveat to the user.
export function deriveEndpointId({ country, vatId, kvk }) {
  const code = normalizeVatCountry(country)
  if (!code) return null

  const normalized = normalizeVatNumber(vatId)
  if (normalized && isValidVatId(code, normalized)) {
    // The Belgian enterprise number IS the ten digits after the BE prefix, and
    // PEPPOL-COMMON-R043 rejects anything else. isValidVatId already ran the
    // mod-97 that rule checks, so this value is known good.
    if (code === 'be') return { schemeId: EAS_BY_COUNTRY.be, value: normalized.slice(2) }
    return { schemeId: EAS_BY_COUNTRY[code], value: normalized }
  }

  const registration = String(kvk ?? '').trim()
  if (code === 'nl' && registration) return { schemeId: EAS_NL_KVK, value: registration }

  return null
}

// ISO 3166-1 alpha-2 codes Peppol accepts (PEPPOL-EN16931-CL001), including the
// 1A and XI extensions.
const ISO3166 = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO '
  + 'BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG '
  + 'EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID '
  + 'IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA '
  + 'MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA '
  + 'PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST '
  + 'SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE '
  + 'YT ZA ZM ZW 1A XI').split(' '))

// Localized-name → code index over EVERY ISO country, not just the ten we know
// VAT rates for: an invoice may be addressed anywhere. Built on first use so
// the SPA does not pay ~1500 Intl.DisplayNames lookups at import time.
let countryNameIndex = null
function nameIndex() {
  if (countryNameIndex) return countryNameIndex
  countryNameIndex = new Map()
  for (const locale of ['en', 'nl', 'de', 'fr', 'es', 'it']) {
    let display
    try {
      display = new Intl.DisplayNames([locale], { type: 'region' })
    } catch { continue }
    for (const code of ISO3166) {
      try {
        const name = display.of(code)
        // DisplayNames echoes the input back for codes it has no name for.
        if (name && name !== code) countryNameIndex.set(name.toLowerCase(), code)
      } catch { /* not a region this runtime names — skip */ }
    }
  }
  return countryNameIndex
}

// Resolves a free-text postal country to an ISO alpha-2 code, or null.
//
// The ONLY input is the address. A VAT number must never be used to infer where
// someone is located — the tax jurisdiction and the postal address are separate
// facts and may legitimately differ.
export function resolvePostalCountry(freeText) {
  if (typeof freeText !== 'string') return null
  const trimmed = freeText.trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  if (upper.length === 2 && ISO3166.has(upper)) return upper
  return nameIndex().get(trimmed.toLowerCase()) ?? null
}

// YYYY-MM-DD (PEPPOL-EN16931-F001). node-postgres hands back a DATE as a Date
// at LOCAL midnight, so the local parts are the calendar date the database
// holds — toISOString() would shift it a day anywhere east of UTC.
export function toUblDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${value.getFullYear()}-${month}-${day}`
  }
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return match ? match[0] : null
}

// Integer cents → a 2-decimal amount. Never via division: (c / 100).toFixed(2)
// reintroduces the floating-point error the cent representation exists to avoid.
export function money(cents) {
  const n = Math.trunc(Number(cents) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// The inverse of money(): an XSD decimal from a UBL document → integer cents.
// Returns null for anything that is not one, so callers decide whether a
// missing amount is fatal.
//
// Deliberately strict, and deliberately NOT the bank statement's amountToCents:
// that one accepts either decimal separator with grouping and returns an
// absolute value, because MT940/CAMT are written by hundreds of banks. A UBL
// amount is schema-constrained to a '.' decimal and its sign is meaningful.
export function parseUblAmount(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.')
  // Scale by string surgery, not by multiplying: 8.29 * 100 is 828.9999…, and
  // rounding that back is exactly the error integer cents exist to avoid.
  const cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2))
  if (!Number.isSafeInteger(cents)) return null
  // Beyond 2 decimals UBL amounts are out of contract; round the remainder in
  // rather than truncating, so 0.005 does not silently become 0.00.
  const rest = fraction.length > 2 ? Number(`0.${fraction.slice(2)}`) : 0
  const scaled = cents + Math.round(rest)
  return negative ? -scaled : scaled
}

// A NUMERIC column value without the trailing zeros pg pads on (2.00 → 2).
export function numeric(value) {
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : '0'
}

// Invoiced quantity (BT-129), always with two fraction digits — the precision of
// the NUMERIC(10,2) column it comes from.
//
// EN 16931 puts no decimal restriction on BT-129 and the Peppol examples print
// bare integers, but writing "1.00" rather than "1" costs nothing and satisfies
// national CIUSes that require an explicit fraction (Italy's BR-IT-380 wants a
// mandatory point plus 2-8 digits). The real-world e-fff reference invoice does
// the same thing.
export function quantity(value) {
  const n = Number(value)
  return (Number.isFinite(n) ? n : 0).toFixed(2)
}

// Unit price (BT-146) derived from the LINE NET, not from the stored unit price.
// PEPPOL-EN16931-R120 asserts LineExtensionAmount ≈ quantity × PriceAmount
// within 0.02, and a 2-decimal unit price breaks that as soon as VAT is backed
// out of an inclusive price (10 × EUR 100 gross at 21% → net 826.45, but
// 10 × 82.64 = 826.40). BT-146 is exempt from the 2-decimal rule.
export function unitPriceAmount(netCents, quantity) {
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty === 0) return money(netCents)
  const fixed = ((Number(netCents) || 0) / (100 * qty)).toFixed(6)
  return fixed.replace(/(\.\d{2}\d*?)0+$/, '$1')
}
