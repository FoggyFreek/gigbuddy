import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VAT_COUNTRY,
  VAT_COUNTRY_CODES,
  VAT_RATE_VALUES,
  getVatRates,
  getStandardVatRate,
  isAllowedVatRate,
  isKnownVatCountry,
  isKnownVatRate,
  normalizeVatCountry,
  snapVatRate,
} from '../../shared/vatRates.js'

describe('vatRates country config', () => {
  it('defaults to the Netherlands', () => {
    expect(DEFAULT_VAT_COUNTRY).toBe('nl')
    expect(getVatRates('nl')).toEqual([21, 9, 0])
    expect(getStandardVatRate('nl')).toBe(21)
  })

  it('exposes distinct rate sets per country', () => {
    expect(getVatRates('de')).toEqual([19, 7, 0])
    expect(getStandardVatRate('de')).toBe(19)
    expect(getVatRates('fr')).toContain(5.5)
  })

  it('lists every configured country', () => {
    expect(VAT_COUNTRY_CODES).toContain('nl')
    expect(VAT_COUNTRY_CODES).toContain('de')
    expect(VAT_COUNTRY_CODES.length).toBeGreaterThan(1)
  })

  it('falls back to the default country for unknown/blank codes', () => {
    expect(getVatRates('xx')).toEqual(getVatRates('nl'))
    expect(getVatRates(undefined)).toEqual(getVatRates('nl'))
    expect(getStandardVatRate('')).toBe(21)
  })

  it('normalizes and recognizes country codes case-insensitively', () => {
    expect(isKnownVatCountry('nl')).toBe(true)
    expect(isKnownVatCountry('NL')).toBe(false) // stored form is lowercase
    expect(normalizeVatCountry('  DE ')).toBe('de')
    expect(normalizeVatCountry('xx')).toBeNull()
  })

  it('validates rates against the country set', () => {
    expect(isAllowedVatRate('de', 19)).toBe(true)
    expect(isAllowedVatRate('de', 21)).toBe(false) // NL rate, not German
    expect(isAllowedVatRate('nl', 21)).toBe(true)
  })

  it('includes Ireland super-reduced 4.8% in the union', () => {
    expect(getVatRates('ie')).toContain(4.8)
    expect(VAT_RATE_VALUES).toContain(4.8)
  })

  it('recognizes any real VAT rate across countries as known (override guard)', () => {
    expect(isKnownVatRate(17)).toBe(true) // Luxembourg standard
    expect(isKnownVatRate(19)).toBe(true) // German standard
    expect(isKnownVatRate(17.5)).toBe(false) // not a current rate anywhere
  })

  it('keeps a foreign rate as an override, snaps only genuine garbage', () => {
    // 19% (a German rate) is kept for an NL tenant — a deliberate override.
    expect(snapVatRate('nl', 19)).toBe(19)
    expect(snapVatRate('nl', 9)).toBe(9)
    expect(snapVatRate('nl', 17.5)).toBe(21) // unknown → NL standard
    expect(snapVatRate('nl', 17.5, 0)).toBe(0) // explicit fallback
  })
})
