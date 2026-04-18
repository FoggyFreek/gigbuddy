import pool from '../db/index.js'

export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

export async function requireApproved(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId])
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    if (user.status !== 'approved') return res.status(403).json({ error: 'Forbidden' })
    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}

export async function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId])
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    if (user.status !== 'approved') return res.status(403).json({ error: 'Forbidden' })
    if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' })
    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}
