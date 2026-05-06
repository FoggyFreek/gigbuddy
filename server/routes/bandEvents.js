import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM band_events WHERE tenant_id = $1 ORDER BY start_date ASC, id ASC',
    [req.tenantId],
  )
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT * FROM band_events WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.post('/', async (req, res) => {
  const { title, start_date, end_date, start_time, end_time, location, notes } = req.body
  if (!title || !start_date) {
    return res.status(400).json({ error: 'title and start_date are required' })
  }
  const resolvedEnd = end_date || start_date
  const { rows } = await pool.query(
    `INSERT INTO band_events (tenant_id, title, start_date, end_date, start_time, end_time, location, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [req.tenantId, title, start_date, resolvedEnd, start_time || null, end_time || null, location || null, notes || null],
  )
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const allowed = ['title', 'start_date', 'end_date', 'start_time', 'end_time', 'location', 'notes']
  const fields = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key])
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })
  fields.push(`updated_at = NOW()`)
  values.push(id, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE band_events SET ${fields.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM band_events WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
