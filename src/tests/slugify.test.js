import { describe, expect, it } from 'vitest'
import { slugFromBandName } from '../utils/slugify.ts'

// Mirrors the server cases in src/tests/server/tenantSelfCreate.test.js —
// the preview must match what the server generates (before dedupe suffixes).
describe('slugFromBandName', () => {
  it('lowercases, strips diacritics, and hyphenates', () => {
    expect(slugFromBandName('Thé Bänd!!')).toBe('the-band')
  })

  it('collapses runs of separators', () => {
    expect(slugFromBandName('The   --  Band')).toBe('the-band')
  })

  it('falls back to "band" for all-symbol names', () => {
    expect(slugFromBandName('!!! ***')).toBe('band')
  })

  it('truncates long names with room for a dedupe suffix', () => {
    const slug = slugFromBandName('X'.repeat(80))
    expect(slug.length).toBeLessThanOrEqual(56)
    expect(slug).toBe('x'.repeat(56))
  })

  it('does not end in a hyphen after truncation', () => {
    expect(slugFromBandName(`${'x'.repeat(55)} tail`)).not.toMatch(/-$/)
  })
})
