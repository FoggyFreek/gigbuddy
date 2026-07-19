// Link enrichment: fetch a URL's metadata (oEmbed for known platforms, Open
// Graph tags otherwise) so the editor can pull titles and artwork straight
// from a pasted link. Only ever called from the authenticated editor — public
// visitors are never the trigger for third-party fetches.
import { detectEmbed } from './embeds.js'

const FETCH_TIMEOUT_MS = 5000
const MAX_HTML_BYTES = 600 * 1024
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 200

// oEmbed endpoints for the platforms bands link most. Everything else falls
// back to Open Graph scraping.
export function oembedEndpointFor(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'open.spotify.com' || host === 'spotify.link') {
    return `https://open.spotify.com/oembed?url=${encodeURIComponent(rawUrl)}`
  }
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`
  }
  if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
    return `https://soundcloud.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`
  }
  if (host === 'vimeo.com') {
    return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(rawUrl)}`
  }
  if (host === 'tiktok.com') {
    return `https://www.tiktok.com/oembed?url=${encodeURIComponent(rawUrl)}`
  }
  return null
}

// SSRF guard: only public http(s) destinations. Blocks loopback/link-local/
// private hosts by name and by IP literal. (DNS-rebinding is out of scope —
// the caller is an authenticated tenant admin, not an anonymous visitor.)
export function isSafeRemoteUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (host === '::1' || host.startsWith('[')) return false
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 127 || a === 10 || a === 0) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 169 && b === 254) return false
  }
  return true
}

// Minimal OG parser: enough for og:title/description/image/site_name plus
// twitter:image and <title> fallbacks. Attribute order varies per site, so
// both content-before-property and property-before-content are matched.
export function parseOgTags(html) {
  const tags = {}
  const metaRe = /<meta\s[^>]*>/gi
  for (const [tag] of html.matchAll(metaRe)) {
    const prop =
      /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
    if (prop && content && tags[prop] === undefined) tags[prop] = decodeEntities(content)
  }
  const title = tags['og:title'] || tags['twitter:title'] || decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '')
  return {
    title: title.trim() || null,
    description: (tags['og:description'] || tags['description'] || '').trim() || null,
    imageUrl: tags['og:image'] || tags['og:image:url'] || tags['twitter:image'] || null,
    siteName: tags['og:site_name'] || null,
  }
}

function decodeEntities(text) {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
}

const cache = new Map()

async function fetchWithLimits(url, accept) {
  const res = await fetch(url, {
    headers: { accept, 'user-agent': 'gigbuddy-linkpage/1.0 (+link page editor unfurl)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`fetch failed with ${res.status}`)
  const text = await res.text()
  return text.slice(0, MAX_HTML_BYTES)
}

// Resolves { url, title, description, imageUrl, siteName, provider, embed }.
// Throws on unreachable/unsafe URLs — the route turns that into a 422.
export async function fetchLinkMetadata(rawUrl) {
  if (!isSafeRemoteUrl(rawUrl)) throw new Error('URL is not fetchable')

  const cached = cache.get(rawUrl)
  if (cached && cached.expires > Date.now()) return cached.value

  let meta = { title: null, description: null, imageUrl: null, siteName: null, provider: null }

  const oembedUrl = oembedEndpointFor(rawUrl)
  if (oembedUrl) {
    try {
      const data = JSON.parse(await fetchWithLimits(oembedUrl, 'application/json'))
      meta = {
        title: data.title || null,
        description: data.author_name ? `by ${data.author_name}` : null,
        imageUrl: data.thumbnail_url || null,
        siteName: data.provider_name || null,
        provider: (data.provider_name || '').toLowerCase() || null,
      }
    } catch {
      // fall through to OG scraping
    }
  }

  if (!meta.title && !meta.imageUrl) {
    const html = await fetchWithLimits(rawUrl, 'text/html,application/xhtml+xml')
    const og = parseOgTags(html)
    meta = { ...og, provider: og.siteName ? og.siteName.toLowerCase() : null }
  }

  // Only keep http(s) image URLs — no data:/javascript: smuggling via OG tags.
  if (meta.imageUrl && !/^https?:\/\//i.test(meta.imageUrl)) meta.imageUrl = null

  const value = { url: rawUrl, ...meta, embed: detectEmbed(rawUrl) }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(rawUrl, { value, expires: Date.now() + CACHE_TTL_MS })
  return value
}
