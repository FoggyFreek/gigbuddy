import { describe, it, expect } from 'vitest'
import { slugFromPath } from '../src/pathSlug.js'

describe('slugFromPath', () => {
  it('parses main and release paths', () => {
    expect(slugFromPath('/thewoods')).toBe('thewoods')
    expect(slugFromPath('/thewoods/underneath-the-sun')).toBe('thewoods/underneath-the-sun')
    expect(slugFromPath('/TheWoods/')).toBe('thewoods') // trailing slash + case
  })

  it('decodes percent-encoded segments', () => {
    expect(slugFromPath('/the%20woods')).toBe('the woods')
  })

  it('returns null for malformed percent-encoding instead of throwing', () => {
    // decodeURIComponent('%E0%A4%A') throws a URIError; must be swallowed.
    expect(() => slugFromPath('/%E0%A4%A')).not.toThrow()
    expect(slugFromPath('/%E0%A4%A')).toBeNull()
    expect(slugFromPath('/foo/%ZZ')).toBeNull()
  })

  it('returns null for empty or over-deep paths', () => {
    expect(slugFromPath('/')).toBeNull()
    expect(slugFromPath('')).toBeNull()
    expect(slugFromPath('/a/b/c')).toBeNull()
  })
})
