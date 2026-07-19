import { describe, it, expect } from 'vitest'
import { parseOgTags, oembedEndpointFor, isSafeRemoteUrl } from '../server/unfurl.js'

describe('parseOgTags', () => {
  it('reads og tags regardless of attribute order and decodes entities', () => {
    const html = `<html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Underneath The Sun &amp; more" />
      <meta content="A new single" property="og:description">
      <meta property="og:image" content="https://cdn.example.com/cover.jpg"/>
      <meta property="og:site_name" content="Bandcamp">
    </head></html>`
    expect(parseOgTags(html)).toEqual({
      title: 'Underneath The Sun & more',
      description: 'A new single',
      imageUrl: 'https://cdn.example.com/cover.jpg',
      siteName: 'Bandcamp',
    })
  })

  it('falls back to twitter:image and <title>', () => {
    const html = `<head><title>Plain page</title>
      <meta name="twitter:image" content="https://cdn.example.com/t.jpg"></head>`
    const og = parseOgTags(html)
    expect(og.title).toBe('Plain page')
    expect(og.imageUrl).toBe('https://cdn.example.com/t.jpg')
  })

  it('survives pages without any metadata', () => {
    expect(parseOgTags('<html><body>hi</body></html>')).toEqual({
      title: null,
      description: null,
      imageUrl: null,
      siteName: null,
    })
  })
})

describe('oembedEndpointFor', () => {
  it('maps the priority platforms to their oEmbed endpoints', () => {
    expect(oembedEndpointFor('https://open.spotify.com/track/x')).toContain('open.spotify.com/oembed')
    expect(oembedEndpointFor('https://www.youtube.com/watch?v=x')).toContain('youtube.com/oembed')
    expect(oembedEndpointFor('https://youtu.be/x')).toContain('youtube.com/oembed')
    expect(oembedEndpointFor('https://soundcloud.com/a/b')).toContain('soundcloud.com/oembed')
    expect(oembedEndpointFor('https://example.com/x')).toBeNull()
  })
})

describe('isSafeRemoteUrl', () => {
  it('allows public http(s) URLs', () => {
    expect(isSafeRemoteUrl('https://open.spotify.com/track/x')).toBe(true)
    expect(isSafeRemoteUrl('http://example.com')).toBe(true)
  })

  it('blocks private, loopback, and non-http destinations', () => {
    expect(isSafeRemoteUrl('http://localhost:3002/api')).toBe(false)
    expect(isSafeRemoteUrl('http://127.0.0.1/x')).toBe(false)
    expect(isSafeRemoteUrl('http://10.0.0.5/x')).toBe(false)
    expect(isSafeRemoteUrl('http://172.16.1.1/x')).toBe(false)
    expect(isSafeRemoteUrl('http://192.168.1.10/x')).toBe(false)
    expect(isSafeRemoteUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isSafeRemoteUrl('http://internal.local/x')).toBe(false)
    expect(isSafeRemoteUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeRemoteUrl('not a url')).toBe(false)
  })
})
