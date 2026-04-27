// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  normalizeOptionalUrl,
  PROFILE_LINK_PROTOCOLS,
  WEB_URL_PROTOCOLS,
} from '../../server/utils/urls.js'

describe('normalizeOptionalUrl', () => {
  it('normalizes allowed http and https URLs', () => {
    expect(normalizeOptionalUrl(' https://example.com/path?q=1 ')).toBe('https://example.com/path?q=1')
    expect(normalizeOptionalUrl('http://example.com')).toBe('http://example.com/')
  })

  it('returns null for empty optional values', () => {
    expect(normalizeOptionalUrl(null)).toBeNull()
    expect(normalizeOptionalUrl(undefined)).toBeNull()
    expect(normalizeOptionalUrl('   ')).toBeNull()
  })

  it('rejects unsafe script-capable schemes', () => {
    expect(() => normalizeOptionalUrl('javascript:alert(1)')).toThrow('Invalid URL')
    expect(() => normalizeOptionalUrl('data:text/html,<script>alert(1)</script>')).toThrow('Invalid URL')
  })

  it('rejects malformed or scheme-less URLs', () => {
    expect(() => normalizeOptionalUrl('example.com')).toThrow('Invalid URL')
    expect(() => normalizeOptionalUrl('http://')).toThrow('Invalid URL')
  })

  it('allows mailto only for profile links', () => {
    expect(
      normalizeOptionalUrl('mailto:booking@example.com', {
        allowedProtocols: PROFILE_LINK_PROTOCOLS,
      }),
    ).toBe('mailto:booking@example.com')

    expect(() =>
      normalizeOptionalUrl('mailto:booking@example.com', {
        allowedProtocols: WEB_URL_PROTOCOLS,
      }),
    ).toThrow('Invalid URL')
  })
})
