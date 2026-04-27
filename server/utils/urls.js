const DEFAULT_ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export function normalizeOptionalUrl(value, { allowedProtocols = DEFAULT_ALLOWED_PROTOCOLS } = {}) {
  if (value == null) return null

  const trimmed = String(value).trim()
  if (!trimmed) return null

  let url
  try {
    url = new URL(trimmed)
  } catch {
    const err = new Error('Invalid URL')
    err.status = 400
    throw err
  }

  if (!allowedProtocols.has(url.protocol)) {
    const err = new Error('Invalid URL')
    err.status = 400
    throw err
  }

  return url.href
}

export const PROFILE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
export const WEB_URL_PROTOCOLS = DEFAULT_ALLOWED_PROTOCOLS
