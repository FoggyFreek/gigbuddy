import crypto from 'crypto'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Called from a service worker (pushsubscriptionchange), which has no access
// to the in-memory CSRF token. sameSite:lax cookies already block cross-origin
// fetches from including the session, so CSRF is redundant here.
const EXEMPT_PATHS = new Set(['/push/resubscribe'])

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export function csrf(req, res, next) {
  if (!req.session?.userId) return next()

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex')
  }
  res.set('X-CSRF-Token', req.session.csrfToken)

  if (SAFE_METHODS.has(req.method)) return next()
  if (EXEMPT_PATHS.has(req.path)) return next()

  const submitted = req.get('X-CSRF-Token')
  if (!timingSafeEqual(submitted, req.session.csrfToken)) {
    return res.status(403).json({ error: 'Invalid CSRF token' })
  }
  next()
}
