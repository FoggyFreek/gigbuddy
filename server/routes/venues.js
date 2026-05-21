import { Router } from 'express'
import pool from '../db/index.js'
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../utils/urls.js'

const router = Router()

const VALID_CATEGORIES = ['venue', 'festival']

const EDITABLE_FIELDS = [
  'category',
  'name',
  'festival_name',
  'title',
  'given_name',
  'family_name',
  'organization_name',
  'street_and_number',
  'street_additional',
  'postal_code',
  'city',
  'region',
  'country',
  'website',
  'phone',
  'email',
]

const INSERT_COLUMNS = ['tenant_id', ...EDITABLE_FIELDS]

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

function buildInsertValues(tenantId, body) {
  const finalCategory = VALID_CATEGORIES.includes(body.category) ? body.category : 'venue'
  let normalizedWebsite = null
  try {
    normalizedWebsite = normalizeOptionalUrl(body.website, { allowedProtocols: WEB_URL_PROTOCOLS })
  } catch {
    normalizedWebsite = null
  }
  return [
    tenantId,
    finalCategory,
    String(body.name).trim(),
    body.festival_name || null,
    body.title || null,
    body.given_name || null,
    body.family_name || null,
    body.organization_name || null,
    body.street_and_number || null,
    body.street_additional || null,
    body.postal_code || null,
    body.city || null,
    body.region || null,
    body.country || null,
    normalizedWebsite,
    body.phone || null,
    body.email || null,
  ]
}

const INSERT_SQL = `INSERT INTO venues (${INSERT_COLUMNS.join(', ')})
     VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING *`

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM venues WHERE tenant_id = $1 ORDER BY name ASC',
    [req.tenantId],
  )
  res.json(rows)
})

router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 3) return res.json([])
  const parsedLimit = parseInt(req.query.limit, 10)
  const limit = Math.max(
    1,
    Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 10, 25),
  )
  const like = `%${q}%`
  const categoryFilter = VALID_CATEGORIES.includes(req.query.category) ? req.query.category : null
  const params = [req.tenantId, like, limit]
  const categoryClause = categoryFilter ? `AND category = $${params.push(categoryFilter)}` : ''
  const { rows } = await pool.query(
    `SELECT id, name, category, festival_name, organization_name,
            city, region, postal_code, country
       FROM venues
      WHERE tenant_id = $1
        AND (name ILIKE $2 OR city ILIKE $2 OR festival_name ILIKE $2)
        ${categoryClause}
      ORDER BY
        CASE
          WHEN name ILIKE $2 THEN 0
          WHEN festival_name ILIKE $2 THEN 1
          ELSE 2
        END,
        name ASC
      LIMIT $3`,
    params,
  )
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT * FROM venues WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.post('/', async (req, res) => {
  if (!req.body.name || !String(req.body.name).trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const { rows } = await pool.query(INSERT_SQL, buildInsertValues(req.tenantId, req.body))
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const fields = []
  const values = []
  let idx = 1
  for (const key of EDITABLE_FIELDS) {
    if (key in req.body) {
      if (key === 'category' && !VALID_CATEGORIES.includes(req.body[key])) {
        return res.status(400).json({ error: 'Invalid category value' })
      }
      // country is CHAR(2): coerce empty string to null to avoid padding.
      const val = key === 'country'
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
  values.push(id, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE venues SET ${fields.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM venues WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
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
         FROM venues WHERE tenant_id = $1 AND lower(name) = ANY($2)`,
        [req.tenantId, incomingNames],
      )
      for (const r of existing) {
        existingKeys.add(`${r.name} ${r.city}`)
      }
    }

    let imported = 0
    let skipped = 0
    const seenKeys = new Set()

    for (const row of req.body) {
      const name = row.name ? String(row.name).trim() : ''
      if (!name) { skipped++; continue }

      const city = row.city ? String(row.city).trim() : ''
      const key = `${name.toLowerCase()} ${city.toLowerCase()}`
      if (existingKeys.has(key) || seenKeys.has(key)) { skipped++; continue }

      await client.query(INSERT_SQL, buildInsertValues(req.tenantId, { ...row, name, city }))
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
