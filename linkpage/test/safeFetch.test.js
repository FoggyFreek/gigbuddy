import { describe, it, expect } from 'vitest'
import { isPublicAddress, assertPublicUrl, pinnedLookup, safeFetchText } from '../server/safeFetch.js'

describe('isPublicAddress', () => {
  it('accepts public unicast v4/v6', () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true)
    expect(isPublicAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(true)
  })

  it('rejects every private / reserved range', () => {
    for (const ip of [
      '127.0.0.1', // loopback
      '10.0.0.5', // private
      '172.16.1.1', // private
      '192.168.1.10', // private
      '169.254.169.254', // link-local (cloud metadata)
      '0.0.0.0', // unspecified
      '100.64.0.1', // carrier-grade NAT
      '::1', // v6 loopback
      'fe80::1', // v6 link-local
      'fc00::1', // v6 unique-local
      'ff02::1', // v6 multicast
      '::ffff:169.254.169.254', // IPv4-mapped IPv6 → link-local
      '::ffff:10.0.0.1', // IPv4-mapped IPv6 → private
      '2002::1', // 6to4
      '2001::1', // teredo
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })

  it('rejects garbage', () => {
    expect(isPublicAddress('not-an-ip')).toBe(false)
  })
})

describe('assertPublicUrl', () => {
  it('accepts ordinary public http(s) URLs', () => {
    expect(() => assertPublicUrl('https://open.spotify.com/track/x')).not.toThrow()
    expect(() => assertPublicUrl('http://example.com:80/path')).not.toThrow()
  })

  it('rejects non-http schemes, credentials, odd ports, and internal/IP-literal hosts', () => {
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow()
    expect(() => assertPublicUrl('http://user:pass@example.com')).toThrow(/credentials/)
    expect(() => assertPublicUrl('http://example.com:8080/')).toThrow(/port/)
    expect(() => assertPublicUrl('http://localhost/')).toThrow(/internal/)
    expect(() => assertPublicUrl('http://127.0.0.1/')).toThrow(/non-public/)
    expect(() => assertPublicUrl('http://169.254.169.254/latest/meta-data')).toThrow(/non-public/)
    expect(() => assertPublicUrl('http://[::1]/')).toThrow(/non-public/)
  })
})

// pinnedLookup resolves IP literals without network, so the connect-time
// control can be exercised offline: it blocks any resolved private address.
describe('pinnedLookup (connection-time pin)', () => {
  const lookup = (host) =>
    new Promise((resolve) => pinnedLookup(host, { all: true }, (err, res) => resolve({ err, res })))

  it('passes a public address through', async () => {
    const { err, res } = await lookup('93.184.216.34')
    expect(err).toBeFalsy()
    expect(res[0].address).toBe('93.184.216.34')
  })

  it('blocks a host resolving to loopback / metadata / mapped-private', async () => {
    expect((await lookup('127.0.0.1')).err).toBeTruthy()
    expect((await lookup('169.254.169.254')).err).toBeTruthy()
    expect((await lookup('::ffff:10.0.0.1')).err).toBeTruthy()
  })
})

describe('safeFetchText redirect handling', () => {
  it('re-validates every hop and refuses a redirect to an internal address', async () => {
    // Public first hop → 302 to the cloud-metadata endpoint. Must be rejected
    // before any second request is made.
    const transport = async (url) => {
      if (url.hostname === 'example.com') {
        return { status: 302, location: 'http://169.254.169.254/latest/meta-data', body: '' }
      }
      throw new Error('should never connect to the redirect target')
    }
    await expect(safeFetchText('http://example.com/', 'text/html', { transport })).rejects.toThrow(/non-public/)
  })

  it('follows a redirect to another public URL and returns the body', async () => {
    const transport = async (url) => {
      if (url.hostname === 'example.com') return { status: 301, location: 'https://cdn.example.org/final', body: '' }
      return { status: 200, location: null, body: 'OK BODY' }
    }
    expect(await safeFetchText('http://example.com/', 'text/html', { transport })).toBe('OK BODY')
  })

  it('caps redirect chains', async () => {
    let n = 0
    const transport = async () => ({ status: 302, location: `https://example.com/${n++}`, body: '' })
    await expect(
      safeFetchText('https://example.com/', 'text/html', { transport, maxRedirects: 3 }),
    ).rejects.toThrow(/too many redirects/)
  })

  it('throws on 4xx/5xx', async () => {
    const transport = async () => ({ status: 500, location: null, body: '' })
    await expect(safeFetchText('https://example.com/', 'text/html', { transport })).rejects.toThrow(/500/)
  })
})
