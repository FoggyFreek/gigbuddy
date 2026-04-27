import { Router } from 'express'
import pool from '../db/index.js'
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../utils/urls.js'

const router = Router()

const VALID_CATEGORIES = ['venue', 'festival']

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
  const { rows } = await pool.query('SELECT * FROM venues ORDER BY name ASC')
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query('SELECT * FROM venues WHERE id = $1', [id])
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.post('/', async (req, res) => {
  const { category, name, city, country, province, address, website, contact_person, phone, email } = req.body
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const finalCategory = VALID_CATEGORIES.includes(category) ? category : 'venue'
  const normalizedWebsite = normalizeOptionalUrl(website, { allowedProtocols: WEB_URL_PROTOCOLS })
  const { rows } = await pool.query(
    `INSERT INTO venues (category, name, city, country, province, address, website, contact_person, phone, email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      finalCategory,
      String(name).trim(),
      city || null,
      country || null,
      province || null,
      address || null,
      normalizedWebsite,
      contact_person || null,
      phone || null,
      email || null,
    ]
  )
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const allowed = ['category', 'name', 'city', 'country', 'province', 'address', 'website', 'contact_person', 'phone', 'email']
  const fields = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (key in req.body) {
      if (key === 'category' && !VALID_CATEGORIES.includes(req.body[key])) {
        return res.status(400).json({ error: 'Invalid category value' })
      }
      // CHAR(2) columns: coerce empty string to null to avoid padding
      const val = (key === 'country' || key === 'province')
        ? (req.body[key] || null)
        : key === 'website'
          ? normalizeOptionalUrl(req.body[key], { allowedProtocols: WEB_URL_PROTOCOLS })
        : req.body[key]
      fields.push(`${key} = $${idx++}`)
      values.push(val)
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })
  fields.push(`updated_at = NOW()`)
  values.push(id)
  const { rows } = await pool.query(
    `UPDATE venues SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query('DELETE FROM venues WHERE id = $1', [id])
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
        `SELECT lower(name) AS name, lower(coalesce(city, '')) AS city
         FROM venues WHERE lower(name) = ANY($1)`,
        [incomingNames]
      )
      for (const r of existing) {
        existingKeys.add(`${r.name}\u0000${r.city}`)
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

      const city = row.city ? String(row.city).trim() : ''
      const nameLow = name.toLowerCase()
      const cityLow = city.toLowerCase()
      const key = `${nameLow}\u0000${cityLow}`
      const isDuplicate = existingKeys.has(key) || seenKeys.has(key)

      if (isDuplicate) { skipped++; continue }

      const finalCategory = VALID_CATEGORIES.includes(row.category) ? row.category : 'venue'
      let normalizedWebsite = null
      try {
        normalizedWebsite = normalizeOptionalUrl(row.website, { allowedProtocols: WEB_URL_PROTOCOLS })
      } catch {
        normalizedWebsite = null
      }
      await client.query(
        `INSERT INTO venues (category, name, city, country, province, address, website, contact_person, phone, email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          finalCategory,
          name,
          city || null,
          row.country || null,
          row.province || null,
          row.address || null,
          normalizedWebsite,
          row.contact_person || null,
          phone || null,
          email || null,
        ]
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
