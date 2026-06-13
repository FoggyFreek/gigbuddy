import { Router } from 'express'
import * as oidc from '../oidc.js'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { buildMePayload, bootstrapCallbackUser, canUseTenant } from '../services/authService.js'

const router = Router()

function saveSession(session) {
  return new Promise((resolve, reject) =>
    session.save((err) => (err ? reject(err) : resolve())),
  )
}

router.get('/login', async (req, res, next) => {
  try {
    const authUrl = await oidc.buildAuthUrl(req.session)
    await saveSession(req.session)
    res.redirect(authUrl.href)
  } catch (err) {
    next(err)
  }
})

router.get('/callback', async (req, res, next) => {
  try {
    const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`)
    const claims = await oidc.handleCallback(req.session, currentUrl)

    const { user, activeTenantId } = await bootstrapCallbackUser(pool, claims)

    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    )
    req.session.userId = user.id
    req.session.activeTenantId = activeTenantId
    await saveSession(req.session)

    auditLog(req, 'auth.login', { userId: user.id, email: user.email })
    res.redirect(process.env.APP_URL || 'http://localhost:5173')
  } catch (err) {
    next(err)
  }
})

router.post('/logout', (req, res, next) => {
  // Capture before session is destroyed.
  const userId = req.session?.userId ?? null
  req.session.destroy((err) => {
    if (err) return next(err)
    auditLog(req, 'auth.logout', { userId })
    res.clearCookie('connect.sid')
    res.status(204).end()
  })
})

router.get('/me', async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const result = await buildMePayload(pool, req.session.userId, req.session.activeTenantId ?? null)
    if (!result) return res.status(401).json({ error: 'Unauthorized' })

    if (req.session.activeTenantId !== result.activeTenantId) {
      req.session.activeTenantId = result.activeTenantId
      await saveSession(req.session)
    }

    res.json(result.payload)
  } catch (err) {
    next(err)
  }
})

router.post('/active-tenant', async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  const tenantId = Number(req.body?.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return res.status(400).json({ error: 'tenantId required' })
  }
  try {
    if (!(await canUseTenant(pool, req.session.userId, tenantId))) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const prevTenantId = req.session.activeTenantId ?? null
    req.session.activeTenantId = tenantId
    await saveSession(req.session)

    auditLog(req, 'auth.tenant.switch', { fromTenantId: prevTenantId, toTenantId: tenantId })
    const result = await buildMePayload(pool, req.session.userId, tenantId)
    if (!result) return res.status(401).json({ error: 'Unauthorized' })
    res.json(result.payload)
  } catch (err) {
    next(err)
  }
})

export default router
