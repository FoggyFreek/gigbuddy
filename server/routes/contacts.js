import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const VALID_CATEGORIES = ['press', 'radio & tv', 'booker', 'promotion', 'network']

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
  const { rows } = await pool.query('SELECT * FROM contacts ORDER BY category ASC, name ASC')
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query('SELECT * FROM contacts WHERE id = $1', [id])
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.post('/', async (req, res) => {
  const { name, email, phone, category } = req.body
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const finalCategory = VALID_CATEGORIES.includes(category) ? category : 'press'
  const { rows } = await pool.query(
    `INSERT INTO contacts (name, email, phone, category)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [String(name).trim(), email || null, phone || null, finalCategory]
  )
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const allowed = ['name', 'email', 'phone', 'category']
  const fields = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (key in req.body) {
      if (key === 'category' && !VALID_CATEGORIES.includes(req.body[key])) {
        return res.status(400).json({ error: 'Invalid category value' })
      }
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key] || null)
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })
  fields.push(`updated_at = NOW()`)
  values.push(id)
  const { rows } = await pool.query(
    `UPDATE contacts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query('DELETE FROM contacts WHERE id = $1', [id])
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

router.post('/import', async (req, res) => {
  if (!Array.isArray(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Expected non-empty array' })
  }
  if (req.body.length > 1000) {
    return res.status(400).json({ error: 'Maximum 1000 rows per import' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const incomingNames = [...new Set(req.body.map(r => r.name ? String(r.name).trim().toLowerCase() : '').filter(Boolean))]
    const existingKeys = new Set()

    if (incomingNames.length) {
      const { rows: existing } = await client.query(
        `SELECT lower(name) AS name, lower(category) AS category
         FROM contacts WHERE lower(name) = ANY($1)`,
        [incomingNames]
      )
      for (const r of existing) {
        existingKeys.add(`${r.name}\u0000${r.category}`)
      }
    }

    let imported = 0
    let skipped = 0
    const seenKeys = new Set()

    for (const row of req.body) {
      const name  = row.name  ? String(row.name).trim()  : ''
      const email = row.email ? String(row.email).trim() : ''
      const phone = row.phone ? String(row.phone).trim() : ''
      if (!name) { skipped++; continue }

      const finalCategory = VALID_CATEGORIES.includes(row.category) ? row.category : 'press'
      const nameLow = name.toLowerCase()
      const categoryLow = finalCategory.toLowerCase()
      const key = `${nameLow}\u0000${categoryLow}`
      const isDuplicate = existingKeys.has(key) || seenKeys.has(key)

      if (isDuplicate) { skipped++; continue }

      await client.query(
        `INSERT INTO contacts (name, email, phone, category) VALUES ($1, $2, $3, $4)`,
        [name, email || null, phone || null, finalCategory]
      )
      imported++
      seenKeys.add(key)
    }
    await client.query('COMMIT')
    res.json({ imported, skipped })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export default router
