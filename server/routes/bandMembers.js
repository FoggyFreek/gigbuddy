import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const MEMBER_FIELDS = ['name', 'role', 'color', 'sort_order', 'position']

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM band_members ORDER BY sort_order ASC, id ASC'
  )
  res.json(rows)
})

router.post('/', async (req, res) => {
  const { name, role, color, position } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const pos = position ?? 'lead'
  if (!['lead', 'optional', 'sub'].includes(pos)) {
    return res.status(400).json({ error: 'position must be lead, optional, or sub' })
  }

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM band_members'
  )
  const nextOrder = maxRows[0].next

  const { rows } = await pool.query(
    'INSERT INTO band_members (name, role, color, sort_order, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, role ?? null, color ?? null, nextOrder, pos]
  )
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })

  const fields = []
  const values = []
  let idx = 1

  for (const key of MEMBER_FIELDS) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key])
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  values.push(id)
  const { rows } = await pool.query(
    `UPDATE band_members SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })

  const { rowCount } = await pool.query('DELETE FROM band_members WHERE id = $1', [id])
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
