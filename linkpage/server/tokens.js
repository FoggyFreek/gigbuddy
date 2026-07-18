// Compact HMAC-signed tokens. Mirror of gigbuddy's server/security/
// linkpageTokens.js — the two apps deliberately share only the secret
// (GIGBUDDY_SYNC_SECRET here, LINKPAGE_SECRET there), never code.
//
// Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(body)).
import crypto from 'node:crypto'

function secret() {
  return process.env.GIGBUDDY_SYNC_SECRET || ''
}

export function signPayload(payload) {
  if (!secret()) throw new Error('GIGBUDDY_SYNC_SECRET is not configured')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${mac}`
}

// Returns the payload object, or null for anything invalid: bad shape, bad
// signature, or an `exp` (epoch seconds) in the past.
export function verifyPayload(token) {
  if (!secret() || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', secret()).update(body).digest()
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
