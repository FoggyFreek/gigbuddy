import { describe, expect, it } from 'vitest'
import {
  TAX_SCHEMES,
  TAX_TREATMENTS,
  TAX_TREATMENT_VERSION,
  getTaxScheme,
  getTaxSchemes,
  isKnownTaxScheme,
  enrolmentCoversDate,
  resolveVatTreatment,
} from '../../shared/taxSchemes.js'
import { BOOKKEEPING_CURRENCIES, bookkeepingCurrency } from '../../shared/accountingProfileCodes.js'
import { fiscalYearRange, fiscalYearForDate } from '../../shared/fiscalYear.js'

// A national_home enrolment row shaped like the repository returns one.
function enrolment(overrides = {}) {
  return {
    scheme_code: 'nl_kor',
    scheme_scope: 'national_home',
    country_code: 'nl',
    valid_from: '2025-01-01',
    valid_to: null,
    voided_at: null,
    ...overrides,
  }
}

describe('taxSchemes registry', () => {
  it('uses the spec §5.4 treatment vocabulary, keeping exemption distinct from zero rate', () => {
    expect(TAX_TREATMENTS).toContain('small_business_exempt')
    expect(TAX_TREATMENTS).toContain('zero_rated')
    // KOR relieves of charging VAT and denies input credit — it is not a 0% rate.
    expect(TAX_SCHEMES.nl_kor.salesTreatment).toBe('small_business_exempt')
    expect(TAX_SCHEMES.nl_kor.inputVatRecoverable).toBe(false)
  })

  it('marks only the Dutch KOR as implemented, matching what the invoice code does', () => {
    expect(TAX_SCHEMES.nl_kor.implemented).toBe(true)
    for (const [code, scheme] of Object.entries(TAX_SCHEMES)) {
      if (code !== 'nl_kor') expect(scheme.implemented).toBe(false)
    }
  })

  it('separates the home national scheme from the cross-border EU SME scheme', () => {
    expect(TAX_SCHEMES.nl_kor.scope).toBe('national_home')
    expect(TAX_SCHEMES.eu_sme.scope).toBe('eu_sme_destination')
    expect(TAX_SCHEMES.eu_sme.perDestination).toBe(true)
  })

  it('offers a country its own national scheme plus EU SME, and nothing else', () => {
    const nl = getTaxSchemes('nl').map((s) => s.code)
    expect(nl).toContain('nl_kor')
    expect(nl).toContain('eu_sme')
    expect(nl).not.toContain('de_kleinunternehmer')

    // Non-EU: no EU SME offer.
    expect(getTaxSchemes('gb').map((s) => s.code)).not.toContain('eu_sme')
  })

  it('offers no national scheme where none exists to enrol in', () => {
    for (const country of ['es', 'ie', 'gb']) {
      const national = getTaxSchemes(country).filter((s) => s.scope === 'national_home')
      expect(national).toEqual([])
    }
  })

  it('validates a code against the exact country, with no default-country fallback', () => {
    expect(isKnownTaxScheme('nl', 'nl_kor')).toBe(true)
    expect(isKnownTaxScheme('de', 'nl_kor')).toBe(false)
    expect(isKnownTaxScheme('xx', 'nl_kor')).toBe(false)
    expect(isKnownTaxScheme('nl', 'made_up')).toBe(false)
    // EU SME is valid for any EU destination, never for a non-EU one.
    expect(isKnownTaxScheme('be', 'eu_sme')).toBe(true)
    expect(isKnownTaxScheme('gb', 'eu_sme')).toBe(false)
  })

  it('returns null for an unknown code rather than throwing', () => {
    expect(getTaxScheme('made_up')).toBeNull()
    expect(getTaxScheme(null)).toBeNull()
  })
})

describe('enrolmentCoversDate', () => {
  it('treats valid_to as the INCLUSIVE last day', () => {
    const e = enrolment({ valid_from: '2025-01-01', valid_to: '2025-12-31' })
    expect(enrolmentCoversDate(e, '2024-12-31')).toBe(false)
    expect(enrolmentCoversDate(e, '2025-01-01')).toBe(true)
    expect(enrolmentCoversDate(e, '2025-12-31')).toBe(true)
    expect(enrolmentCoversDate(e, '2026-01-01')).toBe(false)
  })

  it('treats a NULL valid_to as still open', () => {
    const e = enrolment({ valid_from: '2025-01-01', valid_to: null })
    expect(enrolmentCoversDate(e, '2099-01-01')).toBe(true)
    expect(enrolmentCoversDate(e, '2024-12-31')).toBe(false)
  })

  it('never resolves through a voided enrolment', () => {
    const e = enrolment({ voided_at: '2025-06-01T10:00:00Z' })
    expect(enrolmentCoversDate(e, '2025-06-15')).toBe(false)
  })

  it('normalizes Date columns and ISO timestamps the way pg returns them', () => {
    const e = enrolment({ valid_from: new Date(2025, 0, 1), valid_to: new Date(2025, 11, 31) })
    expect(enrolmentCoversDate(e, new Date(2025, 5, 1))).toBe(true)
    expect(enrolmentCoversDate(e, '2025-12-31T23:59:00Z')).toBe(true)
    expect(enrolmentCoversDate(e, '2026-01-01T00:00:00Z')).toBe(false)
  })

  it('is false for a missing enrolment or an unparseable date', () => {
    expect(enrolmentCoversDate(null, '2025-06-01')).toBe(false)
    expect(enrolmentCoversDate(enrolment(), 'not-a-date')).toBe(false)
    expect(enrolmentCoversDate(enrolment(), null)).toBe(false)
  })
})

describe('resolveVatTreatment', () => {
  const v = TAX_TREATMENT_VERSION

  it('is standard with no enrolment', () => {
    expect(resolveVatTreatment({ version: v, homeEnrolment: null })).toEqual({
      schemeCode: null,
      salesTreatment: 'standard',
      schemeExempt: false,
      chargesOutputVat: true,
      inputVatRecoverable: true,
      version: v,
    })
  })

  it('suppresses output VAT and input credit under an implemented exempt scheme', () => {
    const t = resolveVatTreatment({ version: v, homeEnrolment: enrolment() })
    expect(t.schemeCode).toBe('nl_kor')
    expect(t.salesTreatment).toBe('small_business_exempt')
    expect(t.schemeExempt).toBe(true)
    expect(t.chargesOutputVat).toBe(false)
    expect(t.inputVatRecoverable).toBe(false)
  })

  it('records an unimplemented scheme as provenance but changes no behavior', () => {
    const t = resolveVatTreatment({
      version: v,
      homeEnrolment: enrolment({ scheme_code: 'de_kleinunternehmer', country_code: 'de' }),
    })
    // The scheme is a fact about the band; `standard` is what the software did.
    // The two disagreeing is the population the audit reports.
    expect(t.schemeCode).toBe('de_kleinunternehmer')
    expect(t.salesTreatment).toBe('standard')
    expect(t.schemeExempt).toBe(false)
    expect(t.chargesOutputVat).toBe(true)
    expect(t.inputVatRecoverable).toBe(true)
  })

  it('lets reverse charge outrank the scheme, mirroring vatCategoryCode precedence', () => {
    const t = resolveVatTreatment({ version: v, homeEnrolment: enrolment(), reverseCharge: true })
    expect(t.salesTreatment).toBe('reverse_charge')
    expect(t.chargesOutputVat).toBe(false)
    // The scheme still suppressed VAT in its own right, and still denies input credit.
    expect(t.schemeExempt).toBe(true)
    expect(t.inputVatRecoverable).toBe(false)
  })

  it('reports reverse charge on an unenrolled tenant too', () => {
    const t = resolveVatTreatment({ version: v, homeEnrolment: null, reverseCharge: true })
    expect(t.salesTreatment).toBe('reverse_charge')
    expect(t.chargesOutputVat).toBe(false)
    expect(t.schemeExempt).toBe(false)
    expect(t.inputVatRecoverable).toBe(true)
  })

  it('refuses a destination-scoped enrolment as the home scheme', () => {
    expect(() => resolveVatTreatment({
      version: v,
      homeEnrolment: enrolment({ scheme_code: 'eu_sme', scheme_scope: 'eu_sme_destination', country_code: 'be' }),
    })).toThrow(/national_home/)
  })

  it('refuses a version it does not implement, rather than guessing', () => {
    expect(() => resolveVatTreatment({ version: 2, homeEnrolment: null }))
      .toThrow(/unknown_vat_treatment_version/)
  })
})

describe('bookkeepingCurrency', () => {
  it('keeps a supported currency', () => {
    expect(bookkeepingCurrency('EUR')).toBe('EUR')
  })

  // The profile records GBP truthfully, but the ledger has no currency column
  // and no FX: stamping new documents GBP while the existing ones are EUR would
  // mix two units. A UK band therefore keeps euro books until multi-currency
  // support lands.
  it('clamps a currency the books cannot be kept in', () => {
    expect(bookkeepingCurrency('GBP')).toBe('EUR')
    expect(bookkeepingCurrency('USD')).toBe('EUR')
    expect(bookkeepingCurrency(null)).toBe('EUR')
  })

  it('only lists currencies the whole finance stack can carry', () => {
    expect(BOOKKEEPING_CURRENCIES).toEqual(['EUR'])
  })
})

describe('fiscalYearRange', () => {
  it('resolves 1 January identically to the calendar year it replaced', () => {
    expect(fiscalYearRange(2025, { month: 1, day: 1 }))
      .toEqual({ from: '2025-01-01', toExclusive: '2026-01-01' })
  })

  it('carries an arbitrary start across the year boundary', () => {
    expect(fiscalYearRange(2025, { month: 7, day: 1 }))
      .toEqual({ from: '2025-07-01', toExclusive: '2026-07-01' })
  })

  // Mirrors the tap_financial_year_start_valid CHECK: a fiscal year must start
  // on a date that exists in every year, so 29-31 February is not a range.
  it('refuses a start date that does not exist every year', () => {
    expect(() => fiscalYearRange(2025, { month: 2, day: 29 })).toThrow(RangeError)
    expect(() => fiscalYearRange(2025, { month: 2, day: 30 })).toThrow(RangeError)
    expect(() => fiscalYearRange(2025, { month: 4, day: 31 })).toThrow(RangeError)
    expect(() => fiscalYearRange(2025, { month: 13, day: 1 })).toThrow(RangeError)
  })

  it('assigns a date to the fiscal year it falls in', () => {
    const start = { month: 7, day: 1 }
    expect(fiscalYearForDate('2025-06-30', start)).toBe(2024)
    expect(fiscalYearForDate('2025-07-01', start)).toBe(2025)
  })
})
