import { describe, expect, it } from 'vitest'
import {
  isValidRegistrationNumber,
  registrationSameAsVat,
  registrationUsesOffice,
  getRegistrationLabel,
  getRegistrationExample,
  getRegistrationOfficeLabel,
  LEGAL_FORMS,
  isKnownLegalForm,
  requiresCompanyDisclosure,
} from '../../shared/businessRegistry.js'

describe('businessRegistry', () => {
  // Samples mirror each country's official register format.
  const VALID = {
    nl: ['12345678'],
    de: ['HRB 12345', 'hrb12345', 'HRA 6'],
    fr: ['123456789'],
    lu: ['B123456'],
    at: ['FN 123456a', 'FN123456A'],
    it: ['1234567'],
    ie: ['123456', '1234567'],
    gb: ['12345678', 'SC123456'],
  }

  it.each(Object.entries(VALID))('accepts valid %s registration numbers', (country, samples) => {
    for (const s of samples) expect(isValidRegistrationNumber(country, s)).toBe(true)
  })

  it('rejects malformed registration numbers per country', () => {
    expect(isValidRegistrationNumber('nl', '1234567')).toBe(false) // 7 digits
    expect(isValidRegistrationNumber('de', '12345')).toBe(false) // no HRA/HRB
    expect(isValidRegistrationNumber('fr', '12345')).toBe(false)
    expect(isValidRegistrationNumber('lu', '123456')).toBe(false) // missing B
    expect(isValidRegistrationNumber('gb', '1234567')).toBe(false) // 7 digits
    expect(isValidRegistrationNumber('nl', 'DE123456789')).toBe(false) // wrong country
  })

  it('treats an empty value as valid (clears the field)', () => {
    expect(isValidRegistrationNumber('nl', '')).toBe(true)
    expect(isValidRegistrationNumber('de', '   ')).toBe(true)
  })

  it('for sameAsVat countries accepts only empty (no separate number)', () => {
    expect(registrationSameAsVat('be')).toBe(true)
    expect(registrationSameAsVat('es')).toBe(true)
    expect(isValidRegistrationNumber('be', '')).toBe(true)
    expect(isValidRegistrationNumber('be', '0123456789')).toBe(false)
    expect(isValidRegistrationNumber('es', 'X1234567X')).toBe(false)
    expect(getRegistrationLabel('be')).toBeNull()
  })

  it('marks court/city/province registers as office-scoped', () => {
    for (const c of ['de', 'fr', 'at', 'it']) {
      expect(registrationUsesOffice(c)).toBe(true)
      expect(getRegistrationOfficeLabel(c)).toBeTruthy()
    }
    for (const c of ['nl', 'ie', 'gb', 'lu']) {
      expect(registrationUsesOffice(c)).toBe(false)
      expect(getRegistrationOfficeLabel(c)).toBeNull()
    }
  })

  it('only an incorporated company owes the extra invoice disclosures', () => {
    expect(LEGAL_FORMS).toContain('sole_trader')
    expect(LEGAL_FORMS).toContain('company')
    expect(isKnownLegalForm('company')).toBe(true)
    expect(isKnownLegalForm('llc')).toBe(false)
    expect(requiresCompanyDisclosure('company')).toBe(true)
    // The typical band (sole trader / partnership) owes nothing extra.
    expect(requiresCompanyDisclosure('sole_trader')).toBe(false)
    expect(requiresCompanyDisclosure('partnership')).toBe(false)
    expect(requiresCompanyDisclosure('association')).toBe(false)
    expect(requiresCompanyDisclosure(null)).toBe(false)
  })

  it('exposes a register label and example per country', () => {
    expect(getRegistrationLabel('nl')).toBe('KvK-nummer')
    expect(getRegistrationLabel('de')).toBe('Handelsregisternummer')
    expect(getRegistrationExample('nl')).toBe('12345678')
  })
})
