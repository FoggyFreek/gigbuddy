import { describe, expect, it } from 'vitest'
import {
  luhnValid,
  vatChecksumValid,
  hasVatChecksum,
  checkBE,
  checkDE,
  checkFR,
  checkIT,
  checkAT,
  checkLU,
  checkIE,
  checkGB,
  checkXI,
  checkES,
} from '../../shared/vatChecksum.js'

// National check-digit / control-character algorithms (compliance spec
// FR-ID-003…008). Valid samples are independently-known-valid real numbers where
// possible; each invalid sample is the SAME number with an altered check
// character, so these prove the checksum runs — not just the regex.
describe('vatChecksum — per-country algorithms', () => {
  const KNOWN = {
    be: { fn: checkBE, valid: ['BE0411905847', 'BE0100000070'], badCheck: ['BE0411905848'] },
    de: { fn: checkDE, valid: ['DE136695976', 'DE100000008'], badCheck: ['DE136695977'] },
    fr: { fn: checkFR, valid: ['FR40303265045', 'FR88100000009'], badCheck: ['FR40303265046'] },
    it: { fn: checkIT, valid: ['IT00743110157', 'IT01000000008'], badCheck: ['IT00743110158'] },
    at: { fn: checkAT, valid: ['ATU13585627', 'ATU10000005'], badCheck: ['ATU13585628'] },
    lu: { fn: checkLU, valid: ['LU10000356', 'LU10000053'], badCheck: ['LU10000357'] },
    gb: { fn: checkGB, valid: ['GB980780684', 'GB100000034'], badCheck: ['GB980780685'] },
  }

  it.each(Object.entries(KNOWN))('%s accepts valid and rejects altered check digits', (code, { fn, valid, badCheck }) => {
    for (const v of valid) {
      expect(fn(v)).toBe(true)
      expect(vatChecksumValid(code, v)).toBe(true)
    }
    for (const b of badCheck) {
      expect(fn(b)).toBe(false)
      expect(vatChecksumValid(code, b)).toBe(false)
    }
  })

  it('Ireland handles new, legacy and grouped formats', () => {
    expect(checkIE('IE6388047V')).toBe(true) // 7 digits + check letter (real)
    expect(checkIE('IE8Z49289F')).toBe(true) // legacy digit+letter+5digits+letter
    expect(checkIE('IE6388047W')).toBe(false) // altered check letter
  })

  it('Spain validates NIF, NIE and CIF by type, not regex (FR-ID-003)', () => {
    expect(checkES('ESA28015865')).toBe(true) // CIF, digit control
    expect(checkES('ES12345678Z')).toBe(true) // NIF/DNI
    expect(checkES('ESX1234567L')).toBe(true) // NIE
    expect(checkES('ESA28015866')).toBe(false) // CIF bad control
    expect(checkES('ES12345678A')).toBe(false) // DNI bad letter
    expect(checkES('ESX1234567X')).toBe(false) // NIE bad letter (old placeholder)
  })

  it('Northern Ireland (XI) shares the UK algorithm', () => {
    expect(checkXI('XI980780684')).toBe(true)
    expect(checkXI('XI980780685')).toBe(false)
  })

  it('GB government/health ranges are structural (no checksum)', () => {
    expect(checkGB('GBGD001')).toBe(true)
    expect(checkGB('GBHA599')).toBe(true)
  })

  it('exposes which countries have an algorithmic control', () => {
    for (const c of ['be', 'de', 'fr', 'it', 'at', 'lu', 'ie', 'gb', 'xi', 'es']) {
      expect(hasVatChecksum(c)).toBe(true)
    }
    expect(hasVatChecksum('nl')).toBe(false) // format-only by design
    expect(vatChecksumValid('nl', 'NL123456789B01')).toBe(true) // no checksum → regex stands
  })

  it('luhnValid computes the mod-10 control', () => {
    expect(luhnValid('732829320')).toBe(true) // real SIREN
    expect(luhnValid('732829321')).toBe(false)
    expect(luhnValid('12345678a')).toBe(false) // non-digit
  })
})
