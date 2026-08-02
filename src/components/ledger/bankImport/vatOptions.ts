// The one VAT dropdown of the review grid. A statement carries only the gross
// amount — neither CAMT.053 nor MT940 reports a breakdown — so the treatment is
// the reviewer's call. Every option is a *complete* selection: a rate plus the
// tax category it belongs to, so picking one can never leave a line half-typed.
//
// The plain rate options mirror what the rate-first controls elsewhere in the app
// do: they carry the country's "common" category where one is defined (NL) and
// leave the category to the server to infer everywhere else. The treatments below
// them are the categories whose meaning cannot be inferred from a rate at all
// (reverse charge, intra-EU, exempt, outside scope).
import { getStandardVatRate, getVatRates } from '../../../utils/vatRates.ts'
import { commonVatSelection, getTaxCategoryDefinition, listTaxCategories } from '../../../../shared/taxCategories.js'

export interface VatOption {
  value: string
  label: string
  rate: number | null
  categoryCode: string | null
}

export type VatDirection = 'sale' | 'purchase'

// Categories a rate alone already expresses — offered as plain rates instead, so
// the list has one entry per meaning.
const RATE_DERIVED_CATEGORIES = new Set([
  'domestic_standard', 'domestic_reduced', 'domestic_zero', 'domestic_other_rate',
])

// Scheme-level, not a per-line choice: a tenant on the small-business scheme
// gets no VAT column at all.
const SCHEME_CATEGORIES = new Set(['small_business_exempt'])

interface CategoryDefinition {
  fixedRate?: number
  rateKind?: string
  rateKindByDirection?: Record<string, string>
}

// The rates the server will accept for this category (server/shared mirror:
// `categoryRateValid` in shared/taxCategories.js). Self-assessed categories carry
// the rate the buyer accounts for, so they need a real rate, not 0.
function categoryRates(definition: CategoryDefinition, direction: VatDirection, country: string): number[] {
  if (definition.fixedRate !== undefined) return [definition.fixedRate]
  const kind = definition.rateKindByDirection?.[direction] ?? definition.rateKind
  if (kind === 'zero') return [0]
  if (kind === 'standard') return [getStandardVatRate(country)]
  if (kind === 'reduced') {
    const standard = getStandardVatRate(country)
    return getVatRates(country).filter((rate) => rate > 0 && rate !== standard)
  }
  if (kind === 'known' || kind === 'other') return getVatRates(country).filter((rate) => rate > 0)
  return []
}

export interface VatOptionLabels {
  none: string
  /** Localized rate label (NL spells its three headline rates out). */
  rate: (rate: number) => string
  category: (code: string) => string
}

export function buildVatOptions(
  country: string, direction: VatDirection, labels: VatOptionLabels,
): VatOption[] {
  const options: VatOption[] = [
    { value: 'none', label: labels.none, rate: null, categoryCode: null },
  ]

  for (const rate of getVatRates(country)) {
    options.push({
      value: `rate:${rate}`,
      label: labels.rate(rate),
      rate,
      categoryCode: commonVatSelection(country, rate)?.tax_category_code ?? null,
    })
  }

  for (const code of listTaxCategories(direction) as string[]) {
    if (RATE_DERIVED_CATEGORIES.has(code) || SCHEME_CATEGORIES.has(code)) continue
    const definition = getTaxCategoryDefinition(code) as CategoryDefinition | null
    if (!definition) continue
    const rates = categoryRates(definition, direction, country)
    for (const rate of rates) {
      options.push({
        value: `cat:${code}:${rate}`,
        // A category pinned to a single zero rate reads better without "· 0%".
        label: rates.length === 1 && rate === 0
          ? labels.category(code)
          : `${labels.category(code)} · ${labels.rate(rate)}`,
        rate,
        categoryCode: code,
      })
    }
  }

  return options
}

// The option value that represents a decision's current (rate, category) pair.
// Falls back to the plain rate so a rate saved with no category still selects
// something rather than rendering an empty cell.
export function vatOptionValue(rate: number | null, categoryCode: string | null): string {
  if (categoryCode && !RATE_DERIVED_CATEGORIES.has(categoryCode)) return `cat:${categoryCode}:${rate ?? 0}`
  if (rate == null) return 'none'
  return `rate:${rate}`
}
