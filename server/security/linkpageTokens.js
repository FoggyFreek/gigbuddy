// Compact HMAC-signed tokens for the decoupled link-page app (linkpage/).
//
// One shared secret (LINKPAGE_SECRET) covers all three integration surfaces:
//   - editor handoff tokens minted for signed-in members (short-lived),
//   - public image tokens embedded in export payloads (logo, song covers),
//   - the server-to-server bearer on the content export endpoint.
//
// Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(body)).
// Deliberately dependency-free — the linkpage app carries an identical
// implementation so the two apps only share the secret, never code.
import crypto from 'node:crypto'

export function linkpageConfigured() {
  return Boolean(process.env.LINKPAGE_SECRET && process.env.LINKPAGE_URL)
}

export function linkpageEditorUrl() {
  return process.env.LINKPAGE_URL ? process.env.LINKPAGE_URL.replace(/\/$/, '') : null
}

export function signPayload(payload) {
  const secret = process.env.LINKPAGE_SECRET
  if (!secret) throw new Error('LINKPAGE_SECRET is not configured')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

// Returns the payload object, or null for anything invalid: bad shape, bad
// signature, or an `exp` (epoch seconds) in the past.
export function verifyPayload(token) {
  const secret = process.env.LINKPAGE_SECRET
  if (!secret || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', secret).update(body).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
  return payload
}

// Constant-time check of the server-to-server bearer used by the linkpage app
// to pull content exports. Hash both sides so lengths always match.
export function isValidSyncBearer(headerValue) {
  const secret = process.env.LINKPAGE_SECRET
  if (!secret || typeof headerValue !== 'string') return false
  const match = /^Bearer\s+(.+)$/.exec(headerValue)
  if (!match) return false
  const a = crypto.createHash('sha256').update(match[1]).digest()
  const b = crypto.createHash('sha256').update(secret).digest()
  return crypto.timingSafeEqual(a, b)
}
