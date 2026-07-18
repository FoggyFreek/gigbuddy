// Pure classifiers that reduce a raw request to the coarse, anonymous
// dimensions we are allowed to store (see PRIVACY.md). Raw user agents,
// referrer paths/queries, and IP addresses never leave this module.
import crypto from 'node:crypto'

// Coarse device class from the User-Agent. Deliberately crude: we only ever
// store the class, so misclassification costs a statistic, not privacy.
export function classifyDevice(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return 'unknown'
  const ua = userAgent.toLowerCase()
  if (/bot|crawler|spider|crawling|preview|facebookexternalhit|whatsapp|slackbot|telegrambot/.test(ua)) {
    return 'bot'
  }
  if (/ipad|tablet|kindle|silk/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) {
    return 'tablet'
  }
  if (/mobi|iphone|ipod|android|windows phone/.test(ua)) return 'mobile'
  if (/mozilla|applewebkit|gecko|opera|edg/.test(ua)) return 'desktop'
  return 'unknown'
}

// Traffic source: a utm_source when present, else the referrer's hostname
// (never its path or query — those can carry personal data), else 'direct'.
export function classifySource(referrer, utmSource, ownHost) {
  const utm = typeof utmSource === 'string' ? utmSource.trim().toLowerCase().slice(0, 80) : ''
  if (utm && /^[\w.-]+$/.test(utm)) return utm
  if (typeof referrer === 'string' && referrer) {
    try {
      const host = new URL(referrer).hostname.toLowerCase()
      if (!host) return 'direct'
      if (ownHost && (host === ownHost || host.endsWith(`.${ownHost}`))) return 'direct'
      return host.replace(/^www\./, '').slice(0, 100)
    } catch {
      return 'direct'
    }
  }
  return 'direct'
}

// Country from CDN/proxy geo headers (Cloudflare, Vercel, Fastly, or a
// generic reverse-proxy header). We never do IP-based lookups ourselves —
// if no trusted edge supplies a country, it stays 'unknown'.
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'fastly-country-code', 'x-country-code']

export function resolveCountry(getHeader) {
  for (const name of COUNTRY_HEADERS) {
    const value = getHeader(name)
    if (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) && value.toUpperCase() !== 'XX') {
      return value.toUpperCase()
    }
  }
  return 'unknown'
}

// Anonymous same-day visitor fingerprint for unique-visitor estimates: a
// truncated keyed hash of (day, ip, user agent). The day in the input rotates
// the value every 24h so visits cannot be linked across days, truncation
// makes brute-force reversal impractical, and the raw inputs are discarded.
export function visitorHash(ip, userAgent, secret, now = new Date()) {
  if (!ip && !userAgent) return null
  const day = now.toISOString().slice(0, 10)
  return crypto
    .createHmac('sha256', `${secret || 'linkpage'}|${day}`)
    .update(`${ip || ''}|${userAgent || ''}`)
    .digest('base64url')
    .slice(0, 16)
}
