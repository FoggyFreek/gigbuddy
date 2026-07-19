import { describe, it, expect } from 'vitest'
import { slugFromSegments, mainSlugOf, MAIN_SLUG_RE } from '../server/app.js'

describe('slugFromSegments', () => {
  it('accepts a single-segment main slug', () => {
    expect(slugFromSegments(['foo'])).toBe('foo')
    expect(slugFromSegments(['foo-bar'])).toBe('foo-bar')
    expect(slugFromSegments('FooBar')).toBe('foobar')
  })

  it('accepts a two-segment release path and joins it', () => {
    expect(slugFromSegments(['foo', 'bar'])).toBe('foo/bar')
    expect(slugFromSegments(['foo-bar', 'summer-single'])).toBe('foo-bar/summer-single')
  })

  it('rejects empty, over-long, three-segment, or malformed paths', () => {
    expect(slugFromSegments([])).toBeNull()
    expect(slugFromSegments(['foo', 'bar', 'baz'])).toBeNull()
    expect(slugFromSegments(['-bad'])).toBeNull()
    expect(slugFromSegments(['foo', ''])).toBe('foo') // trailing empty segment ignored → main
    expect(slugFromSegments(['a'.repeat(200)])).toBeNull()
  })

  it('a main slug can never contain a slash — release and main namespaces cannot collide', () => {
    // The string a release occupies ('foo/bar') can never be produced as a
    // single main-slug segment, so no main slug ever equals a release slug.
    expect(MAIN_SLUG_RE.test('foo/bar')).toBe(false)
    expect(slugFromSegments(['foo/bar'])).toBeNull()
  })
})

describe('mainSlugOf', () => {
  it('returns the slug for a main page and the first segment for a release', () => {
    expect(mainSlugOf({ page_type: 'main', slug: 'foo' })).toBe('foo')
    expect(mainSlugOf({ page_type: 'release', slug: 'foo/bar' })).toBe('foo')
    expect(mainSlugOf({ page_type: 'release', slug: 'foo-bar/summer' })).toBe('foo-bar')
  })
})
