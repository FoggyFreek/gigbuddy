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
export const VAT_COUNTRIES = Object.freeze({
  nl: { standard: 21, rates: [21, 9, 0] },
  be: { standard: 21, rates: [21, 12, 6, 0] },
  de: { standard: 19, rates: [19, 7, 0] },
  fr: { standard: 20, rates: [20, 10, 5.5, 2.1, 0] },
  lu: { standard: 17, rates: [17, 14, 8, 3, 0] },
  at: { standard: 20, rates: [20, 13, 10, 0] },
  es: { standard: 21, rates: [21, 10, 4, 0] },
  it: { standard: 22, rates: [22, 10, 5, 4, 0] },
  ie: { standard: 23, rates: [23, 13.5, 9, 4.8, 0] },
  gb: { standard: 20, rates: [20, 5, 0] },
})

// Every distinct VAT rate across all supported countries, high→low. Used as the
// override set: a transaction may carry any real rate (e.g. the band performed
// in another country), even one outside the tenant's home country.
export const VAT_RATE_VALUES = Object.freeze(
  [...new Set(Object.values(VAT_COUNTRIES).flatMap((c) => c.rates))].sort((a, b) => b - a),
)

export const VAT_COUNTRY_CODES = Object.freeze(Object.keys(VAT_COUNTRIES))

export function isKnownVatCountry(code) {
  return typeof code === 'string' && Object.hasOwn(VAT_COUNTRIES, code)
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
