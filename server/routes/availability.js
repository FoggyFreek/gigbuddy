import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const SLOT_FIELDS = ['band_member_id', 'start_date', 'end_date', 'status', 'reason']
const VALID_STATUSES = new Set(['available', 'unavailable'])

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function validateSlot({ start_date, end_date, status }) {
  if (status !== undefined && !VALID_STATUSES.has(status)) {
    return 'status must be available or unavailable'
  }
  if (start_date && end_date && end_date < start_date) {
    return 'end_date must be >= start_date'
  }
  return null
}

router.get('/', async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' })

  const { rows } = await pool.query(
    'SELECT * FROM availability_slots WHERE start_date <= $1 AND end_date >= $2 ORDER BY created_at ASC',
    [to, from]
  )
  res.json(rows)
})

router.get('/on/:date', async (req, res) => {
  const { date } = req.params

  const { rows: members } = await pool.query(
    'SELECT * FROM band_members ORDER BY sort_order ASC, id ASC'
  )
  const { rows: slots } = await pool.query(
    'SELECT * FROM availability_slots WHERE start_date <= $1 AND end_date >= $1 ORDER BY created_at ASC',
    [date]
  )

  const bandWide = slots.filter((s) => s.band_member_id === null).at(-1) ?? null

  const result = members.map((m) => {
    const memberSlot = slots.filter((s) => s.band_member_id === m.id).at(-1)
    const winner = bandWide ?? memberSlot
    return {
      member_id: m.id,
      name: m.name,
      color: m.color,
      role: m.role,
      position: m.position,
      status: winner ? winner.status : 'default',
      reason: winner?.reason ?? null,
      source: bandWide ? 'band' : memberSlot ? 'member' : 'default',
    }
  })

  res.json({ members: result, bandWide })
})

router.post('/', async (req, res) => {
  const { band_member_id, start_date, end_date, status, reason } = req.body
  if (!start_date || !end_date || !status) {
    return res.status(400).json({ error: 'start_date, end_date and status are required' })
  }

  const err = validateSlot({ start_date, end_date, status })
  if (err) return res.status(400).json({ error: err })

  if (band_member_id != null) {
    const { rows } = await pool.query('SELECT id FROM band_members WHERE id = $1', [band_member_id])
    if (!rows.length) return res.status(400).json({ error: 'band_member_id not found' })
  }

  const { rows } = await pool.query(
    `INSERT INTO availability_slots (band_member_id, start_date, end_date, status, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [band_member_id ?? null, start_date, end_date, status, reason ?? null]
  )
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })

  const err = validateSlot(req.body)
  if (err) return res.status(400).json({ error: err })

  const fields = []
  const values = []
  let idx = 1

  for (const key of SLOT_FIELDS) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key])
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  fields.push(`updated_at = NOW()`)
  values.push(id)
  const { rows } = await pool.query(
    `UPDATE availability_slots SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })

  const { rowCount } = await pool.query('DELETE FROM availability_slots WHERE id = $1', [id])
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
