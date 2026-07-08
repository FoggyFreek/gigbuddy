import pool from '../db/index.js'
import { setContextField } from '../utils/requestContextStore.js'
import { TERMS_VERSION } from '../../shared/termsVersion.js'

export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

export async function loadUser(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  setContextField('userId', req.session.userId)
  if (req.user) return next()
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId])
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}

export async function requireApproved(req, res, next) {
  loadUser(req, res, (err) => {
    if (err) return next(err)
    if (!req.user) return
    if (req.user.status !== 'approved') return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}

// Blocks non-super-admin users whose accepted terms version doesn't match the
// current one. Callers deliberately leave only login/logout, /me, acceptance,
// invite redemption, and the onboarding bootstrap reads outside this gate. A
// null terms_version is stale too. The structured code makes an already-open
// SPA reload onto the current acceptance page after a version publication.
export function requireCurrentTerms(req, res, next) {
  loadUser(req, res, (err) => {
    if (err) return next(err)
    if (!req.user) return
    // Super admins are the recovery path for account and tenant incidents;
    // terms publication must never lock them out of the application.
    if (req.user.is_super_admin) return next()
    if ((req.user.terms_version ?? null) !== TERMS_VERSION) {
      return res.status(403).json({
        error: 'Acceptance of the current terms and conditions is required',
        code: 'terms_acceptance_required',
        termsVersion: TERMS_VERSION,
      })
    }
    next()
  })
}
