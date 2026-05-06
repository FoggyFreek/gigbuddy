import { Router } from 'express'
import * as oidc from '../oidc.js'
import pool from '../db/index.js'

const router = Router()

async function buildMePayload(userId, sessionActiveTenantId) {
  const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId])
  const user = userRows[0]
  if (!user) return null

  const { rows: memberships } = await pool.query(
    `SELECT m.tenant_id, m.role, m.status, t.slug AS tenant_slug, t.band_name AS tenant_name
     FROM memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1
       AND m.status IN ('pending', 'approved')
       AND t.archived_at IS NULL
     ORDER BY m.tenant_id ASC`,
    [user.id],
  )

  const approved = memberships.filter((m) => m.status === 'approved')
  let activeTenantId = sessionActiveTenantId ?? null
  let activeMembership = approved.find((m) => m.tenant_id === activeTenantId)
  if (!activeMembership) {
    activeMembership = approved[0] || null
    activeTenantId = activeMembership?.tenant_id ?? null
  }

  let bandMemberId = null
  if (activeTenantId) {
    const { rows: bm } = await pool.query(
      'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2',
      [user.id, activeTenantId],
    )
    bandMemberId = bm[0]?.id ?? null
  }

  const activeTenantRole = activeMembership?.role ?? null
  const isSuperAdmin = !!user.is_super_admin

  return {
    payload: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      pictureUrl: user.picture_url,
      isSuperAdmin,
      activeTenantId,
      activeTenantRole,
      bandMemberId,
      memberships: memberships.map((m) => ({
        tenantId: m.tenant_id,
        tenantName: m.tenant_name,
        tenantSlug: m.tenant_slug,
        role: m.role,
        status: m.status,
      })),
    },
    activeTenantId,
  }
}

router.get('/login', async (req, res, next) => {
  try {
    const authUrl = await oidc.buildAuthUrl(req.session)
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    )
    res.redirect(authUrl.href)
  } catch (err) {
    next(err)
  }
})

router.get('/callback', async (req, res, next) => {
  try {
    const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`)
    const claims = await oidc.handleCallback(req.session, currentUrl)

    const { rows: adminCheck } = await pool.query(
      'SELECT 1 FROM users WHERE is_super_admin = TRUE LIMIT 1',
    )
    const bootstrapAdmin =
      adminCheck.length === 0 && claims.email === process.env.ADMIN_EMAIL
    const newUserIsSuperAdmin = bootstrapAdmin
    // Per-tenant membership.status is the real gate. New users land approved
    // globally so they can reach /api/invites/redeem and /auth/me; tenant
    // access still requires an approved membership in some tenant.
    const newUserStatus = 'approved'

    const { rows } = await pool.query(
      `INSERT INTO users (google_sub, email, name, picture_url, is_super_admin, status, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (google_sub) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         picture_url = EXCLUDED.picture_url,
         last_login_at = NOW()
       RETURNING *`,
      [
        claims.sub,
        claims.email,
        claims.name,
        claims.picture,
        newUserIsSuperAdmin,
        newUserStatus,
      ],
    )
    const user = rows[0]

    if (bootstrapAdmin) {
      await pool.query(
        `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
         VALUES ($1, 1, 'tenant_admin', 'approved', NOW())
         ON CONFLICT (user_id, tenant_id) DO UPDATE SET
           role = 'tenant_admin',
           status = 'approved',
           approved_at = COALESCE(memberships.approved_at, NOW())`,
        [user.id],
      )
    }

    const { rows: firstApproved } = await pool.query(
      `SELECT m.tenant_id
         FROM memberships m
         JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1
          AND m.status = 'approved'
          AND t.archived_at IS NULL
        ORDER BY m.tenant_id ASC
        LIMIT 1`,
      [user.id],
    )

    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    )
    req.session.userId = user.id
    req.session.activeTenantId = firstApproved[0]?.tenant_id ?? null
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    )

    res.redirect(process.env.APP_URL || 'http://localhost:5173')
  } catch (err) {
    next(err)
  }
})

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err)
    res.clearCookie('connect.sid')
    res.status(204).end()
  })
})

router.get('/me', async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const result = await buildMePayload(req.session.userId, req.session.activeTenantId ?? null)
    if (!result) return res.status(401).json({ error: 'Unauthorized' })

    if (req.session.activeTenantId !== result.activeTenantId) {
      req.session.activeTenantId = result.activeTenantId
      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve())),
      )
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
    const { rows } = await pool.query(
      `SELECT 1
         FROM memberships m
         JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1
          AND m.tenant_id = $2
          AND m.status = 'approved'
          AND t.archived_at IS NULL`,
      [req.session.userId, tenantId],
    )
    if (rows.length === 0) return res.status(403).json({ error: 'Forbidden' })

    req.session.activeTenantId = tenantId
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    )

    const result = await buildMePayload(req.session.userId, tenantId)
    if (!result) return res.status(401).json({ error: 'Unauthorized' })
    res.json(result.payload)
  } catch (err) {
    next(err)
  }
})

export default router
