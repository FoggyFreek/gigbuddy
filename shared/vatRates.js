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
// `example` drives the input placeholder and helper text. Sources: EU VIES /
// Wikipedia "VAT identification number" and HMRC (GB). Prefix always matches
// the two-letter country code.
export const VAT_ID_FORMATS = Object.freeze({
  nl: { pattern: /^NL\d{9}B\d{2}$/, example: 'NL123456789B01' },
  be: { pattern: /^BE[01]\d{9}$/, example: 'BE0123456789' },
  de: { pattern: /^DE\d{9}$/, example: 'DE123456789' },
  fr: { pattern: /^FR[A-Z0-9]{2}\d{9}$/, example: 'FRXX123456789' },
  lu: { pattern: /^LU\d{8}$/, example: 'LU12345678' },
  at: { pattern: /^ATU\d{8}$/, example: 'ATU12345678' },
  es: { pattern: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, example: 'ESX1234567X' },
  it: { pattern: /^IT\d{11}$/, example: 'IT12345678901' },
  // Ireland: new format 7 digits + 1–2 letters (IE9999999WI), or the legacy
  // digit + [letter/+/*] + 5 digits + letter (IE9S99999L). Per the EU VIES table.
  ie: { pattern: /^IE(\d{7}[A-Z]{1,2}|\d[A-Z0-9+*]\d{5}[A-Z])$/, example: 'IE1234567FA' },
  gb: { pattern: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/, example: 'GB123456789' },
})

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

function vatIdFormatFor(country) {
  return VAT_ID_FORMATS[normalizeVatCountry(country) ?? DEFAULT_VAT_COUNTRY]
}

// A sample VAT identification number for the country (placeholder / helper text).
export function getVatIdExample(country) {
  return vatIdFormatFor(country).example
}

// True when `value` is a well-formed VAT identification number for the country.
// `value` is expected already whitespace-stripped and uppercased.
export function isValidVatId(country, value) {
  return vatIdFormatFor(country).pattern.test(String(value))
}
