import { describe, it, expect } from 'vitest'
import {
  EAS_BY_COUNTRY,
  deriveEndpointId,
  resolvePostalCountry,
  toUblDate,
  money,
  numeric,
  quantity,
  unitPriceAmount,
} from '../../shared/peppol.js'
import { VAT_COUNTRY_CODES } from '../../shared/vatRates.js'

describe('EAS_BY_COUNTRY', () => {
  it('covers exactly the supported VAT countries', () => {
    expect(Object.keys(EAS_BY_COUNTRY).sort()).toEqual([...VAT_COUNTRY_CODES].sort())
  })

  it('uses the Peppol-registered scheme for each country', () => {
    // Austria is 9914 (UID); 9915 is the administrative identifier, not the VAT one.
    expect(EAS_BY_COUNTRY).toEqual({
      nl: '9944', be: '0208', de: '9930', fr: '9957', lu: '9938',
      at: '9914', es: '9920', it: '0211', ie: '9935', gb: '9932',
    })
  })
})

describe('deriveEndpointId', () => {
  it('addresses Belgian participants by enterprise number, not VAT number', () => {
    // Belgian participants register under the CBE number; the BE prefix is not
    // part of it and PEPPOL-COMMON-R043 requires exactly 10 digits.
    expect(deriveEndpointId({ country: 'be', vatId: 'BE0779341748' }))
      .toEqual({ schemeId: '0208', value: '0779341748' })
  })

  it('uses the VAT number verbatim for the other countries', () => {
    expect(deriveEndpointId({ country: 'nl', vatId: 'NL819789471B01' }))
      .toEqual({ schemeId: '9944', value: 'NL819789471B01' })
    expect(deriveEndpointId({ country: 'de', vatId: 'DE136695976' }))
      .toEqual({ schemeId: '9930', value: 'DE136695976' })
  })

  it('normalizes spacing and case on the way in', () => {
    expect(deriveEndpointId({ country: 'nl', vatId: ' nl819789471b01 ' }))
      .toEqual({ schemeId: '9944', value: 'NL819789471B01' })
  })

  it('falls back to the Dutch KVK number when there is no VAT number', () => {
    expect(deriveEndpointId({ country: 'nl', vatId: null, kvk: '12345678' }))
      .toEqual({ schemeId: '0106', value: '12345678' })
  })

  it('does not offer a KVK fallback outside the Netherlands', () => {
    expect(deriveEndpointId({ country: 'be', vatId: null, kvk: '0779341748' })).toBeNull()
  })

  it('returns null when the country is unknown or nothing identifies the party', () => {
    expect(deriveEndpointId({ country: 'pt', vatId: 'PT123456789' })).toBeNull()
    expect(deriveEndpointId({ country: 'nl', vatId: null, kvk: null })).toBeNull()
    expect(deriveEndpointId({ country: null, vatId: 'NL819789471B01' })).toBeNull()
  })

  it('rejects a Belgian number that fails the enterprise-number checksum', () => {
    // Same shape, wrong mod-97 check digits — R043 would reject it downstream.
    expect(deriveEndpointId({ country: 'be', vatId: 'BE0779341749' })).toBeNull()
  })
})

describe('resolvePostalCountry', () => {
  it('accepts an ISO alpha-2 code in any case', () => {
    expect(resolvePostalCountry('NL')).toBe('NL')
    expect(resolvePostalCountry('be')).toBe('BE')
  })

  it('accepts a country name in the languages the app deals with', () => {
    expect(resolvePostalCountry('Netherlands')).toBe('NL')
    expect(resolvePostalCountry('Nederland')).toBe('NL')
    expect(resolvePostalCountry('Deutschland')).toBe('DE')
  })

  it('resolves countries beyond the ten supported VAT jurisdictions', () => {
    // The address is where the customer is, which is not limited to the
    // countries we know VAT rates for.
    expect(resolvePostalCountry('Portugal')).toBe('PT')
    expect(resolvePostalCountry('PT')).toBe('PT')
  })

  it('returns null for anything it cannot place', () => {
    expect(resolvePostalCountry('Atlantis')).toBeNull()
    expect(resolvePostalCountry('')).toBeNull()
    expect(resolvePostalCountry(null)).toBeNull()
    // Not an ISO country code, so not a country.
    expect(resolvePostalCountry('ZZ')).toBeNull()
  })
})

describe('toUblDate', () => {
  it('keeps the calendar date pg handed us, regardless of timezone', () => {
    // node-postgres returns DATE as a Date at LOCAL midnight; toISOString would
    // roll it back a day anywhere east of UTC.
    expect(toUblDate(new Date(2026, 6, 28))).toBe('2026-07-28')
    expect(toUblDate(new Date(2026, 0, 1))).toBe('2026-01-01')
  })

  it('accepts an ISO string', () => {
    expect(toUblDate('2026-07-28')).toBe('2026-07-28')
    expect(toUblDate('2026-07-28T00:00:00.000Z')).toBe('2026-07-28')
  })

  it('returns null for missing or unparseable input', () => {
    expect(toUblDate(null)).toBeNull()
    expect(toUblDate('')).toBeNull()
    expect(toUblDate('not a date')).toBeNull()
  })
})

describe('money', () => {
  it('formats integer cents without floating point', () => {
    expect(money(0)).toBe('0.00')
    expect(money(5)).toBe('0.05')
    expect(money(15000)).toBe('150.00')
    expect(money(82645)).toBe('826.45')
  })

  it('formats negative amounts', () => {
    expect(money(-1)).toBe('-0.01')
    expect(money(-15000)).toBe('-150.00')
  })
})

describe('numeric', () => {
  it('trims trailing zeros pg adds to NUMERIC columns', () => {
    expect(numeric('2.00')).toBe('2')
    expect(numeric('21.00')).toBe('21')
    expect(numeric(5.5)).toBe('5.5')
    expect(numeric(0)).toBe('0')
  })
})

describe('quantity', () => {
  it('always writes an explicit two-digit fraction', () => {
    // Italy's BR-IT-380 requires a mandatory decimal point with 2-8 digits;
    // a bare "1" fails it. Harmless everywhere else.
    expect(quantity(1)).toBe('1.00')
    expect(quantity('3.00')).toBe('3.00')
    expect(quantity(2.5)).toBe('2.50')
    expect(quantity(0)).toBe('0.00')
    expect(quantity(-3)).toBe('-3.00')
  })

  it('matches the Italian CIUS quantity pattern', () => {
    const BR_IT_380 = /^-?\d{1,12}\.\d{2,8}$/
    for (const value of [1, 0, 2.5, '10.00', 99999999.99]) {
      expect(quantity(value)).toMatch(BR_IT_380)
    }
  })
})

describe('unitPriceAmount', () => {
  it('derives the price from the line net so quantity x price reconciles', () => {
    // 10 x EUR 100 gross at 21% -> line net 826.45. Rounding the unit price to
    // 2 decimals gives 10 x 82.64 = 826.40, a 5 cent gap that fails R120.
    expect(unitPriceAmount(82645, 10)).toBe('82.645')
    expect(Number(unitPriceAmount(82645, 10)) * 10).toBeCloseTo(826.45, 6)
  })

  it('keeps at least two decimals', () => {
    expect(unitPriceAmount(50000, 1)).toBe('500.00')
    expect(unitPriceAmount(0, 1)).toBe('0.00')
  })

  it('falls back to the net amount when the quantity is zero', () => {
    expect(unitPriceAmount(15000, 0)).toBe('150.00')
  })
})
