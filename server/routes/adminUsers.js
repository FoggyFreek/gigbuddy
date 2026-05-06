import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.picture_url, u.status,
              u.is_super_admin, u.created_at, u.last_login_at,
              COALESCE(
                (SELECT json_agg(
                          json_build_object(
                            'tenant_id', m.tenant_id,
                            'tenant_slug', t.slug,
                            'role', m.role,
                            'status', m.status
                          ) ORDER BY m.tenant_id
                        )
                   FROM memberships m
                   JOIN tenants t ON t.id = m.tenant_id
                  WHERE m.user_id = u.id),
                '[]'::json
              ) AS memberships
         FROM users u
        ORDER BY u.id`,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  const userId = Number(req.params.id)
  try {
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [userId])
    if (!rows[0]) return res.status(404).json({ error: 'User not found' })
    if (rows[0].email === process.env.ADMIN_EMAIL) {
      return res.status(400).json({ error: 'Cannot delete the bootstrap admin user' })
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' })
    }
    await pool.query('DELETE FROM users WHERE id = $1', [userId])
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
