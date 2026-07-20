// Typed frontend accessor over the shared VAT-rate source of truth
// (shared/vatRates.js). Keeps the rate lists and country set identical between
// backend validation and the rate dropdowns in the purchase, merch, journal and
// invoice UIs. Mirrors the src/auth/permissions.ts pattern (values from the JS,
// types declared here).
import {
  VAT_COUNTRY_CODES as VAT_COUNTRY_CODES_JS,
  DEFAULT_VAT_COUNTRY as DEFAULT_VAT_COUNTRY_JS,
  VAT_RATE_VALUES as VAT_RATE_VALUES_JS,
  getVatRates as getVatRatesJs,
  getStandardVatRate as getStandardVatRateJs,
  isAllowedVatRate as isAllowedVatRateJs,
  getVatIdExample as getVatIdExampleJs,
  isValidVatId as isValidVatIdJs,
} from '../../shared/vatRates.js'

export const VAT_COUNTRY_CODES: string[] = VAT_COUNTRY_CODES_JS as string[]
export const DEFAULT_VAT_COUNTRY: string = DEFAULT_VAT_COUNTRY_JS as string
export const VAT_RATE_VALUES: number[] = VAT_RATE_VALUES_JS as number[]

export function getVatRates(country: string | null | undefined): number[] {
  return getVatRatesJs(country ?? undefined) as number[]
}

export function getStandardVatRate(country: string | null | undefined): number {
  return getStandardVatRateJs(country ?? undefined) as number
}

export function isAllowedVatRate(country: string | null | undefined, rate: number): boolean {
  return isAllowedVatRateJs(country ?? undefined, rate) as boolean
}

// A sample VAT identification number for the country (input placeholder / hint).
export function getVatIdExample(country: string | null | undefined): string {
  return getVatIdExampleJs(country ?? undefined) as string
}

// True when `value` (whitespace/case-insensitive) is a valid VAT identification
// number for the country.
export function isValidVatId(country: string | null | undefined, value: string): boolean {
  return isValidVatIdJs(country ?? undefined, value.replace(/\s+/g, '').toUpperCase()) as boolean
}

// Rate options for a select, guaranteeing `current` is present even when it is
// not one of the country's standard rates (e.g. a record saved before the VAT
// country changed), so the dropdown never renders a value with no matching item.
export function vatRateOptions(country: string | null | undefined, current: number | null | undefined): number[] {
  const rates = getVatRates(country)
  if (current == null || rates.includes(current)) return rates
  return [...rates, current].sort((a, b) => b - a)
}

export interface VatRateGroups {
  /** The tenant's home-country rates (the common case). */
  primary: number[]
  /** Every other real VAT rate, offered as an override (e.g. gig abroad). */
  other: number[]
}

// Splits selectable rates into the home-country set and an override set of every
// other real VAT rate, so a rate selector can offer "played another country"
// overrides under a separate heading. `current` is guaranteed to appear in one
// of the two groups even if it is a custom value outside all known rates.
export function vatRateGroups(country: string | null | undefined, current: number | null | undefined): VatRateGroups {
  const primary = getVatRates(country)
  const other = VAT_RATE_VALUES.filter((r) => !primary.includes(r))
  if (current != null && !primary.includes(current) && !other.includes(current)) {
    other.push(current)
    other.sort((a, b) => b - a)
  }
  return { primary, other }
}
