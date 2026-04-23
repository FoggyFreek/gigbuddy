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

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, subject, created_at FROM email_templates ORDER BY name ASC'
  )
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query('SELECT * FROM email_templates WHERE id = $1', [id])
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.post('/', async (req, res) => {
  const { name, subject, body_html } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const { rows } = await pool.query(
    `INSERT INTO email_templates (name, subject, body_html)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, subject || '', body_html || '']
  )
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const allowed = ['name', 'subject', 'body_html']
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
  values.push(id)
  const { rows } = await pool.query(
    `UPDATE email_templates SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query('DELETE FROM email_templates WHERE id = $1', [id])
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
