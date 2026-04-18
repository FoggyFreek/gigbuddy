import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const ALLOWED_STATUS = new Set(['pending', 'approved', 'rejected'])

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.*,
              bm.id AS band_member_id
       FROM users u
       LEFT JOIN band_members bm ON bm.user_id = u.id
       ORDER BY
         CASE u.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
         u.created_at`,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  const { status, band_member_id } = req.body
  const userId = Number(req.params.id)

  if (status !== undefined && !ALLOWED_STATUS.has(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  try {
    if (status !== undefined) {
      const { rowCount } = await pool.query(
        'UPDATE users SET status = $1 WHERE id = $2',
        [status, userId],
      )
      if (rowCount === 0) return res.status(404).json({ error: 'User not found' })
    }

    if (band_member_id !== undefined) {
      // Unlink any band_member currently pointing at this user
      await pool.query('UPDATE band_members SET user_id = NULL WHERE user_id = $1', [userId])
      if (band_member_id !== null) {
        await pool.query('UPDATE band_members SET user_id = $1 WHERE id = $2', [userId, band_member_id])
      }
    }

    const { rows } = await pool.query(
      `SELECT u.*, bm.id AS band_member_id
       FROM users u
       LEFT JOIN band_members bm ON bm.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    )
    res.json(rows[0])
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
      return res.status(400).json({ error: 'Cannot delete the admin user' })
    }
    await pool.query('DELETE FROM users WHERE id = $1', [userId])
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
