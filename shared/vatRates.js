// Single source of truth for VAT rates by country. Consumed by BOTH the backend
// (rate validation + defaults for purchases, journals, merch, invoices) and the
// frontend (rate dropdowns, via the typed wrapper in src/utils/vatRates.ts).
//
// VAT tariffs are country-dependent, so a tenant's `vat_country` (see the
// migration adding tenants.vat_country) selects which rate set applies. Rates
// are percentages stored in NUMERIC(5,2) columns, so non-integer reduced rates
// (e.g. 5.5) are fine.
//
// This replaces the copies of `[21, 9, 0]` / `ALLOWED_TAX_RATES` that used to be
// duplicated across the purchase/journal/merch validators and their frontend
// counterparts. Add or correct a country here and every consumer follows.

import { vatChecksumValid, hasVatChecksum } from './vatChecksum.js'

export const DEFAULT_VAT_COUNTRY = 'nl'

// country code (ISO 3166-1 alpha-2, lowercase) -> { standard, rates }
//   `rates`    — selectable rates, ordered high→low, ending in 0 (zero-rated/exempt).
//   `standard` — the standard rate, used as the default for new lines/products.
//
// Rates validated for 2026 against the European Commission "Your Europe" VAT
// guidance and the Tax Foundation "VAT Rates in Europe" table (each country's
// standard, reduced and super-reduced rates). Sources:
//   https://europa.eu/youreurope/business/taxation/vat/vat-rules-rates/
//   https://taxfoundation.org/data/all/eu/value-added-tax-vat-rates-europe/
// Update the rate set (and this note) when a country changes its rates.
//
// `vatLabel`   — the country's VAT tax term, for the VAT column and totals on an
//                invoice (Dutch btw, German USt, French TVA, …).
// `vatIdLabel` — how the VAT identification number is labelled (USt-IdNr., N° TVA,
//                P.IVA, …). Both come from the national VAT terminology / VIES.
// `eu` marks EU member states. The UK (gb) is supported for VAT rates and its
// own VAT-number/registration format, but is NOT an EU member: EU-specific rules
// (intra-EU Art. 196 reverse charge, the EU SME scheme) do not apply to it.
export const VAT_COUNTRIES = Object.freeze({
  nl: { standard: 21, rates: [21, 9, 0], vatLabel: 'btw', vatIdLabel: 'Btw-nr.', eu: true },
  be: { standard: 21, rates: [21, 12, 6, 0], vatLabel: 'btw', vatIdLabel: 'Btw-nr.', eu: true },
  de: { standard: 19, rates: [19, 7, 0], vatLabel: 'USt', vatIdLabel: 'USt-IdNr.', eu: true },
  fr: { standard: 20, rates: [20, 10, 5.5, 2.1, 0], vatLabel: 'TVA', vatIdLabel: 'N° TVA', eu: true },
  lu: { standard: 17, rates: [17, 14, 8, 3, 0], vatLabel: 'TVA', vatIdLabel: 'No. TVA', eu: true },
  at: { standard: 20, rates: [20, 13, 10, 0], vatLabel: 'USt', vatIdLabel: 'UID', eu: true },
  es: { standard: 21, rates: [21, 10, 4, 0], vatLabel: 'IVA', vatIdLabel: 'NIF', eu: true },
  it: { standard: 22, rates: [22, 10, 5, 4, 0], vatLabel: 'IVA', vatIdLabel: 'P.IVA', eu: true },
  ie: { standard: 23, rates: [23, 13.5, 9, 4.8, 0], vatLabel: 'VAT', vatIdLabel: 'VAT no.', eu: true },
  gb: { standard: 20, rates: [20, 5, 0], vatLabel: 'VAT', vatIdLabel: 'VAT no.', eu: false },
})

// Every distinct VAT rate across all supported countries, high→low. Used as the
// override set: a transaction may carry any real rate (e.g. the band performed
// in another country), even one outside the tenant's home country.
export const VAT_RATE_VALUES = Object.freeze(
  [...new Set(Object.values(VAT_COUNTRIES).flatMap((c) => c.rates))].sort((a, b) => b - a),
)

export const VAT_COUNTRY_CODES = Object.freeze(Object.keys(VAT_COUNTRIES))

// VAT identification number format per country, for validating a tenant's
// tax_id against its VAT country. Patterns match the whitespace-stripped,
// uppercased number (prefixed with the country code, as VIES/HMRC print it).
// The regex is only the FIRST gate (structural plausibility); a country-specific
// checksum in shared/vatChecksum.js is the second (so a mistyped/transposed but
// well-shaped number is rejected — FR-ID-003…008 of the compliance spec). The
// `example` numbers below are genuinely checksum-valid so they double as fixtures
// and honest placeholders. `xi` (Northern Ireland) is a distinct VAT prefix that
// shares the UK number algorithm but must never be treated as a GB number or as
// a general EU-services identifier (FR-VIES-002). Prefix always matches the code.
export const VAT_ID_FORMATS = Object.freeze({
  nl: { pattern: /^NL\d{9}B\d{2}$/, example: 'NL123456789B01' },
  be: { pattern: /^BE[01]\d{9}$/, example: 'BE0411905847' },
  de: { pattern: /^DE\d{9}$/, example: 'DE136695976' },
  fr: { pattern: /^FR[A-Z0-9]{2}\d{9}$/, example: 'FR40303265045' },
  lu: { pattern: /^LU\d{8}$/, example: 'LU10000356' },
  at: { pattern: /^ATU\d{8}$/, example: 'ATU13585627' },
  es: { pattern: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, example: 'ESA28015865' },
  it: { pattern: /^IT\d{11}$/, example: 'IT00743110157' },
  // Ireland: new format 7 digits + 1–2 letters (IE9999999WI), or the legacy
  // digit + [letter/+/*] + 5 digits + letter (IE9S99999L). Per the EU VIES table.
  ie: { pattern: /^IE(\d{7}[A-Z]{1,2}|\d[A-Z0-9+*]\d{5}[A-Z])$/, example: 'IE6388047V' },
  gb: { pattern: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/, example: 'GB980780684' },
  xi: { pattern: /^XI(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/, example: 'XI980780684' },
})

// Codes accepted by isValidVatId: the configured VAT countries plus Northern
// Ireland (xi). Used to keep prefix consistency checks honest.
export const VAT_ID_CODES = Object.freeze(new Set([...Object.keys(VAT_ID_FORMATS)]))

export function isKnownVatCountry(code) {
  return typeof code === 'string' && Object.hasOwn(VAT_COUNTRIES, code)
}

// True when the (normalized) country is an EU member — the precondition for
// intra-EU rules such as Art. 196 reverse charge.
export function isEuVatCountry(code) {
  const c = normalizeVatCountry(code)
  return c !== null && VAT_COUNTRIES[c].eu === true
}

// The Dutch KOR is a NATIONAL small-business VAT exemption; it only applies when
// the tenant's VAT country is the Netherlands. (The EU-wide SME scheme is a
// separate, per-country enrolment and is not modelled by the applies_kor flag.)
export function korApplies(country) {
  return normalizeVatCountry(country) === 'nl'
}

// Trims + lowercases a country code and returns it only when it is a known VAT
// country; otherwise null. Callers decide whether to fall back to the default.
export function normalizeVatCountry(code) {
  if (typeof code !== 'string') return null
  const c = code.trim().toLowerCase()
  return isKnownVatCountry(c) ? c : null
}

// Localized-name → code index for the supported countries, built once from the
// platform's region names (Germany / Deutschland / Duitsland / Allemagne → de).
// Lets us resolve the free-text customer country on an invoice, and gig drafts
// that copy a venue's country *name* rather than a code.
const VAT_COUNTRY_NAME_INDEX = (() => {
  const index = new Map()
  const locales = ['en', 'nl', 'de', 'fr', 'es', 'it']
  for (const code of VAT_COUNTRY_CODES) {
    for (const locale of locales) {
      try {
        const name = new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase())
        if (name) index.set(name.toLowerCase(), code)
      } catch { /* locale unavailable — skip */ }
    }
  }
  return index
})()

// Resolves a country given as either an ISO alpha-2 code OR a country name (in
// any of the common languages) to a supported VAT country code, else null.
export function resolveVatCountry(input) {
  const code = normalizeVatCountry(input)
  if (code) return code
  if (typeof input !== 'string') return null
  return VAT_COUNTRY_NAME_INDEX.get(input.trim().toLowerCase()) ?? null
}

function configFor(country) {
  return VAT_COUNTRIES[normalizeVatCountry(country) ?? DEFAULT_VAT_COUNTRY]
}

// The selectable rates for a country (unknown/blank → the default country's).
export function getVatRates(country) {
  return configFor(country).rates
}

// The standard rate for a country — the default for new purchase/merch lines.
export function getStandardVatRate(country) {
  return configFor(country).standard
}

// The country's VAT tax term (btw / USt / TVA / IVA / VAT), for VAT columns and
// totals on an invoice issued from that country.
export function getVatLabel(country) {
  return configFor(country).vatLabel
}

// How the country labels a VAT identification number (Btw-nr. / USt-IdNr. / …).
export function getVatIdLabel(country) {
  return configFor(country).vatIdLabel
}

// True when `rate` is one of the country's own allowed rates.
export function isAllowedVatRate(country, rate) {
  return configFor(country).rates.includes(Number(rate))
}

// True when `rate` is a real VAT rate in ANY supported country. This is the
// override guard: it accepts a foreign rate (band performed abroad) while still
// rejecting nonsense, without pinning the value to the tenant's home country.
export function isKnownVatRate(rate) {
  return VAT_RATE_VALUES.includes(Number(rate))
}

// Snaps a requested rate to a real VAT rate: keeps any known rate (home or a
// deliberate foreign override), otherwise returns `fallback` (defaults to the
// country's standard rate).
export function snapVatRate(country, rate, fallback) {
  const n = Number(rate)
  if (isKnownVatRate(n)) return n
  return fallback === undefined ? configFor(country).standard : fallback
}

// Normalizes an id-country argument to a code that has a VAT-id format: the
// configured VAT countries plus `xi`. Returns null for anything else — unlike
// the rate helpers there is NO fallback to the default country, so an unknown
// jurisdiction never borrows another country's format and passes (FR-ID-009).
function normalizeVatIdCountry(country) {
  if (typeof country !== 'string') return null
  const c = country.trim().toLowerCase()
  return VAT_ID_CODES.has(c) ? c : null
}

// A sample VAT identification number for the country (placeholder / helper text).
// Placeholders are advisory, so an unknown country still shows the default one.
export function getVatIdExample(country) {
  return (VAT_ID_FORMATS[normalizeVatIdCountry(country)] ?? VAT_ID_FORMATS[DEFAULT_VAT_COUNTRY]).example
}

// True when `value` is a well-formed VAT identification number for the country
// AND passes that country's checksum/control algorithm. `value` is expected
// already whitespace-stripped and uppercased. An unknown country returns false
// (no wildcard fallback). Countries without a checksum (nl) pass on the regex.
export function isValidVatId(country, value) {
  const code = normalizeVatIdCountry(country)
  if (!code) return false
  const v = String(value)
  if (!VAT_ID_FORMATS[code].pattern.test(v)) return false
  return vatChecksumValid(code, v)
}

// The two-letter jurisdiction a VAT number declares by its prefix (lowercased),
// or null when it isn't one we recognize. Distinguishes gb from xi (FR-ID-002).
export function vatIdPrefixCountry(value) {
  const p = String(value ?? '').trim().slice(0, 2).toLowerCase()
  return VAT_ID_CODES.has(p) ? p : null
}

// Validation depth actually achieved for a VAT id, so a report can distinguish
// FORMAT_VALID from AUTHORITY_VERIFIED (FR-REG-007 / FR-VIES-003). We perform
// local checks only; a number is NEVER authority-verified until a VIES lookup is
// added, so `authorityVerified` is always false here.
export function describeVatIdValidation(country) {
  const code = normalizeVatIdCountry(country)
  return {
    level: 'format', // 'format' (+checksum) — never 'authority' without VIES
    checksum: code ? hasVatChecksum(code) : false,
    authorityVerified: false,
  }
}
