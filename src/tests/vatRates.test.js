import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VAT_COUNTRY,
  VAT_COUNTRY_CODES,
  VAT_RATE_VALUES,
  getVatRates,
  getStandardVatRate,
  getVatIdExample,
  getVatLabel,
  getVatIdLabel,
  isAllowedVatRate,
  isKnownVatCountry,
  isKnownVatRate,
  isValidVatId,
  isEuVatCountry,
  korApplies,
  normalizeVatCountry,
  resolveVatCountry,
  snapVatRate,
  vatIdPrefixCountry,
  describeVatIdValidation,
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

  it('keeps the tenants.vat_country DB constraint in sync with VAT_COUNTRIES', () => {
    // The CHECK enumerates the supported codes so an unsupported country cannot
    // be stored (and then silently compute at Dutch rates). If a country is
    // added to VAT_COUNTRIES without extending the migration constraint, the DB
    // would reject saving it — this guards against that drift.
    const migration = readFileSync(
      resolve(globalThis.process.cwd(), 'server/db/migrations/124_tenant_vat_country.sql'),
      'utf8',
    )
    const inClause = migration.match(/vat_country IN \(([^)]*)\)/)
    expect(inClause).not.toBeNull()
    const constraintCodes = [...inClause[1].matchAll(/'([a-z]{2})'/g)].map((m) => m[1])
    expect(new Set(constraintCodes)).toEqual(new Set(VAT_COUNTRY_CODES))
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

  // Valid samples are genuinely CHECKSUM-valid, not merely regex-shaped: real
  // published numbers where possible (AT/BE/DE/FR/IT/LU/IE/GB/ES known-valid),
  // plus generated ones. NL is checksum-exempt (format-only) by design.
  const VALID_VAT_IDS = {
    nl: ['NL123456789B01'],
    be: ['BE0411905847', 'BE0100000070'],
    de: ['DE136695976', 'DE100000008'],
    fr: ['FR40303265045', 'FR88100000009'],
    lu: ['LU10000356', 'LU10000053'],
    at: ['ATU13585627', 'ATU10000005'],
    es: ['ESA28015865', 'ES12345678Z', 'ESX1234567L'], // CIF, NIF (DNI), NIE
    it: ['IT00743110157', 'IT01000000008'],
    ie: ['IE6388047V', 'IE8Z49289F', 'IE1000000H'], // new, legacy, generated
    gb: ['GB980780684', 'GB100000034', 'GBGD001', 'GBHA599'],
  }

  it.each(Object.entries(VALID_VAT_IDS))('accepts valid %s VAT numbers', (country, samples) => {
    for (const sample of samples) expect(isValidVatId(country, sample)).toBe(true)
  })

  it('rejects malformed VAT numbers per country', () => {
    expect(isValidVatId('nl', 'NL12345678B01')).toBe(false) // 8 digits, not 9
    expect(isValidVatId('nl', 'NL123456789X01')).toBe(false) // missing literal B
    expect(isValidVatId('be', 'BE2123456789')).toBe(false) // prefix must be 0/1
    expect(isValidVatId('at', 'ATX12345678')).toBe(false) // needs U
    expect(isValidVatId('it', 'IT1234567890')).toBe(false) // 10 digits, not 11
    expect(isValidVatId('gb', 'GB1234567')).toBe(false) // 7 digits
  })

  it('rejects regex-valid numbers that FAIL the checksum (not format-only)', () => {
    // Each is structurally correct but has a bad check digit/character.
    expect(isValidVatId('be', 'BE0411905848')).toBe(false)
    expect(isValidVatId('de', 'DE123456789')).toBe(false)
    expect(isValidVatId('fr', 'FR40303265046')).toBe(false)
    expect(isValidVatId('it', 'IT00743110158')).toBe(false)
    expect(isValidVatId('at', 'ATU13585628')).toBe(false)
    expect(isValidVatId('lu', 'LU10000357')).toBe(false)
    expect(isValidVatId('ie', 'IE6388047W')).toBe(false)
    expect(isValidVatId('gb', 'GB980780685')).toBe(false)
    expect(isValidVatId('es', 'ESA28015866')).toBe(false)
  })

  it('never wildcard-passes an unknown jurisdiction (FR-ID-009)', () => {
    // No fallback to the default country's format: an unknown country fails.
    expect(isValidVatId('us', 'US123456789')).toBe(false)
    expect(isValidVatId('xx', 'NL123456789B01')).toBe(false)
    expect(isValidVatId('', 'NL123456789B01')).toBe(false)
  })

  it('validates Northern Ireland (XI) distinctly from GB', () => {
    expect(isValidVatId('xi', 'XI980780684')).toBe(true)
    expect(isValidVatId('xi', 'XI980780685')).toBe(false) // bad checksum
    expect(isValidVatId('gb', 'XI980780684')).toBe(false) // XI number is not GB
    expect(isValidVatId('xi', 'GB980780684')).toBe(false) // GB number is not XI
    expect(vatIdPrefixCountry('XI980780684')).toBe('xi')
    expect(vatIdPrefixCountry('GB980780684')).toBe('gb')
  })

  it('reports local validation depth (FORMAT_VALID, never AUTHORITY_VERIFIED)', () => {
    // We never call VIES here, so nothing is authority-verified.
    expect(describeVatIdValidation('de')).toEqual({ level: 'format', checksum: true, authorityVerified: false })
    expect(describeVatIdValidation('nl')).toEqual({ level: 'format', checksum: false, authorityVerified: false })
    expect(describeVatIdValidation('us').authorityVerified).toBe(false)
  })

  it('does not accept a number from the wrong country', () => {
    // Every country's valid samples must fail for every other country.
    for (const [country, samples] of Object.entries(VALID_VAT_IDS)) {
      for (const other of Object.keys(VALID_VAT_IDS)) {
        if (other === country) continue
        for (const sample of samples) expect(isValidVatId(other, sample)).toBe(false)
      }
    }
  })

  it('resolves a country given as a code or a localized name', () => {
    expect(resolveVatCountry('de')).toBe('de')
    expect(resolveVatCountry('DE')).toBe('de')
    expect(resolveVatCountry('Germany')).toBe('de')
    expect(resolveVatCountry('Deutschland')).toBe('de')
    expect(resolveVatCountry('Duitsland')).toBe('de') // Dutch name
    expect(resolveVatCountry('Frankrijk')).toBe('fr')
    expect(resolveVatCountry('Netherlands')).toBe('nl')
    expect(resolveVatCountry('Xanadu')).toBeNull()
    expect(resolveVatCountry('')).toBeNull()
  })

  it('marks EU membership (UK is supported but not EU)', () => {
    expect(isEuVatCountry('nl')).toBe(true)
    expect(isEuVatCountry('de')).toBe(true)
    expect(isEuVatCountry('gb')).toBe(false)
    expect(isEuVatCountry('xx')).toBe(false)
  })

  it('treats KOR as a Dutch-only exemption', () => {
    expect(korApplies('nl')).toBe(true)
    expect(korApplies('NL')).toBe(true)
    expect(korApplies('de')).toBe(false)
    expect(korApplies('be')).toBe(false)
  })

  it('localizes the VAT term and VAT-number label per country', () => {
    expect(getVatLabel('nl')).toBe('btw')
    expect(getVatLabel('de')).toBe('USt')
    expect(getVatLabel('fr')).toBe('TVA')
    expect(getVatIdLabel('de')).toBe('USt-IdNr.')
    expect(getVatIdLabel('it')).toBe('P.IVA')
    expect(getVatLabel('xx')).toBe('btw') // unknown → default country
  })

  it('gives a sample VAT number for each country', () => {
    expect(getVatIdExample('nl')).toBe('NL123456789B01')
    expect(getVatIdExample('de')).toMatch(/^DE/)
    expect(getVatIdExample('xx')).toBe('NL123456789B01') // unknown → default
  })

  it('keeps a foreign rate as an override, snaps only genuine garbage', () => {
    // 19% (a German rate) is kept for an NL tenant — a deliberate override.
    expect(snapVatRate('nl', 19)).toBe(19)
    expect(snapVatRate('nl', 9)).toBe(9)
    expect(snapVatRate('nl', 17.5)).toBe(21) // unknown → NL standard
    expect(snapVatRate('nl', 17.5, 0)).toBe(0) // explicit fallback
  })
})
