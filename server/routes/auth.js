import { Router } from 'express'
import * as oidc from '../oidc.js'
import pool from '../db/index.js'

const router = Router()

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
    const currentUrl = new URL(
      req.originalUrl,
      `${req.protocol}://${req.hostname}:${process.env.SERVER_PORT || 3002}`,
    )
    const claims = await oidc.handleCallback(req.session, currentUrl)

    const { rows: adminCheck } = await pool.query(
      'SELECT 1 FROM users WHERE is_admin = TRUE LIMIT 1',
    )
    const bootstrapAdmin =
      adminCheck.length === 0 && claims.email === process.env.ADMIN_EMAIL
    const newUserIsAdmin = bootstrapAdmin
    const newUserStatus = bootstrapAdmin ? 'approved' : 'pending'

    const { rows } = await pool.query(
      `INSERT INTO users (google_sub, email, name, picture_url, is_admin, status, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (google_sub) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         picture_url = EXCLUDED.picture_url,
         last_login_at = NOW()
       RETURNING *`,
      [claims.sub, claims.email, claims.name, claims.picture, newUserIsAdmin, newUserStatus],
    )

    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    )
    req.session.userId = rows[0].id
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
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId])
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const { rows: bm } = await pool.query(
      'SELECT id FROM band_members WHERE user_id = $1',
      [user.id],
    )

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      isAdmin: user.is_admin,
      pictureUrl: user.picture_url,
      bandMemberId: bm[0]?.id ?? null,
    })
  } catch (err) {
    next(err)
  }
})

export default router
