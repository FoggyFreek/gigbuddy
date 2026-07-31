import {
  VAT_COUNTRIES,
  isKnownVatCountry,
  isKnownVatRate,
  normalizeVatCountry,
} from './vatRates.js'

export const TAX_TREATMENTS = Object.freeze([
  'standard',
  'reduced',
  'zero_rated',
  'exempt_no_credit',
  'outside_scope',
  'reverse_charge',
  'small_business_exempt',
])

const CATEGORY_DEFINITIONS = Object.freeze({
  domestic_standard: { treatment: 'standard', directions: ['sale', 'purchase'], rateKind: 'standard' },
  domestic_reduced: { treatment: 'reduced', directions: ['sale', 'purchase'], rateKind: 'reduced' },
  domestic_other_rate: { treatment: 'standard', directions: ['sale'], rateKind: 'other' },
  domestic_zero: { treatment: 'zero_rated', directions: ['sale', 'purchase'], fixedRate: 0 },
  domestic_exempt: { treatment: 'exempt_no_credit', directions: ['sale', 'purchase'], fixedRate: 0 },
  outside_scope: { treatment: 'outside_scope', directions: ['sale', 'purchase'], fixedRate: 0 },
  domestic_reverse_charge: {
    treatment: 'reverse_charge',
    directions: ['sale', 'purchase'],
    rateKindByDirection: { sale: 'zero', purchase: 'known' },
    selfAssessed: true,
  },
  private_use_adjustment: { treatment: 'standard', directions: ['adjustment'], rateKind: 'known' },
  export_non_eu_goods: { treatment: 'zero_rated', directions: ['sale'], fixedRate: 0 },
  intra_eu_supply_goods: { treatment: 'zero_rated', directions: ['sale'], fixedRate: 0, icpCandidate: true },
  intra_eu_supply_services: { treatment: 'reverse_charge', directions: ['sale'], fixedRate: 0, icpCandidate: true },
  eu_distance_installation_non_oss: { treatment: 'outside_scope', directions: ['sale'], rateKind: 'known' },
  import_article_23: { treatment: 'reverse_charge', directions: ['purchase'], rateKind: 'known', selfAssessed: true },
  non_eu_service_reverse_charge: { treatment: 'reverse_charge', directions: ['purchase'], rateKind: 'known', selfAssessed: true },
  intra_eu_acquisition_goods: { treatment: 'reverse_charge', directions: ['purchase'], rateKind: 'known', selfAssessed: true },
  intra_eu_acquisition_services: { treatment: 'reverse_charge', directions: ['purchase'], rateKind: 'known', selfAssessed: true },
  import_vat_paid: { treatment: 'standard', directions: ['purchase'], rateKind: 'known' },
  foreign_vat: { treatment: 'outside_scope', directions: ['purchase'], rateKind: 'known' },
  small_business_exempt: { treatment: 'small_business_exempt', directions: ['sale'], fixedRate: 0 },
})

export const TAX_CATEGORY_CODES = Object.freeze(Object.keys(CATEGORY_DEFINITIONS))

// The short, ordinary Dutch path shown by rate-first form controls. These are
// deliberately only the three Belastingdienst headline rates; reverse charge,
// exemptions, intra-EU transactions and other legal treatments remain explicit
// advanced categories because their meaning cannot be inferred from 0% alone.
const COMMON_VAT_RATE_CATEGORIES = Object.freeze({
  nl: Object.freeze({
    21: 'domestic_standard',
    9: 'domestic_reduced',
    0: 'domestic_zero',
  }),
})

export function commonVatSelection(countryCode, rate) {
  const country = normalizeVatCountry(countryCode)
  if (!country) return null
  const categoryCode = COMMON_VAT_RATE_CATEGORIES[country]?.[Number(rate)]
  if (!categoryCode) return null
  return Object.freeze({
    tax_category_code: categoryCode,
    tax_jurisdiction_code: country,
  })
}

export function getTaxCategoryDefinition(categoryCode) {
  return CATEGORY_DEFINITIONS[categoryCode] ?? null
}

export function listTaxCategories(direction) {
  return TAX_CATEGORY_CODES.filter((code) =>
    CATEGORY_DEFINITIONS[code].directions.includes(direction))
}

export function taxCategoryUsesZeroRate(categoryCode, direction) {
  const definition = getTaxCategoryDefinition(categoryCode)
  if (!definition) return false
  return definition.fixedRate === 0 || definition.rateKindByDirection?.[direction] === 'zero'
}

function categoryRateValid(countryCode, definition, rate, direction) {
  const n = Number(rate)
  if (!Number.isFinite(n) || n < 0 || n > 100) return false
  if (definition.fixedRate !== undefined) return n === definition.fixedRate
  const rateKind = definition.rateKindByDirection?.[direction] ?? definition.rateKind
  if (rateKind === 'zero') return n === 0
  if (rateKind === 'known') return isKnownVatRate(n)
  const country = VAT_COUNTRIES[countryCode]
  if (rateKind === 'standard') return n === country.standard
  if (rateKind === 'reduced') return n > 0 && n !== country.standard && country.rates.includes(n)
  if (rateKind === 'other') return n > 0
  return false
}

export function resolveTaxCategory({
  countryCode,
  categoryCode,
  taxPoint,
  rate,
  direction,
}) {
  const country = normalizeVatCountry(countryCode)
  const definition = getTaxCategoryDefinition(categoryCode)
  if (!country || !definition || !definition.directions.includes(direction)) return null
  if (typeof taxPoint !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(taxPoint)) return null
  if (!categoryRateValid(country, definition, rate, direction)) return null
  return Object.freeze({
    code: categoryCode,
    countryCode: country,
    treatment: definition.treatment,
    rate: Number(rate),
    selfAssessed: definition.selfAssessed === true,
    icpCandidate: definition.icpCandidate === true,
    version: `${country}-tax-categories-2026.1`,
  })
}

export function defaultDomesticCategory(countryCode, rate) {
  const country = normalizeVatCountry(countryCode)
  if (!country || !isKnownVatCountry(country)) return null
  const n = Number(rate)
  if (n === 0) return 'domestic_zero'
  if (n === VAT_COUNTRIES[country].standard) return 'domestic_standard'
  if (VAT_COUNTRIES[country].rates.includes(n)) return 'domestic_reduced'
  return null
}

export function effectiveCategoryTreatment(categoryCode, schemeTreatment = null) {
  const definition = getTaxCategoryDefinition(categoryCode)
  if (!definition) return null
  if (schemeTreatment === 'small_business_exempt' && definition.directions.includes('sale')) {
    return 'small_business_exempt'
  }
  return definition.treatment
}
