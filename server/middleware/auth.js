import pool from '../db/index.js'

export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

export async function loadUser(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
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
