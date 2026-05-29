import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const VALID_CATEGORIES = new Set(['press', 'radio & tv', 'booker', 'promotion', 'network'])

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
    'SELECT * FROM contacts WHERE tenant_id = $1 ORDER BY category ASC, name ASC',
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
  const prefix = `${q}%`
  const { rows } = await pool.query(
    `SELECT id, name, category, email, phone
       FROM contacts
      WHERE tenant_id = $1
        AND (name ILIKE $2 OR email ILIKE $2)
      ORDER BY
        CASE WHEN name ILIKE $3 THEN 0 ELSE 1 END,
        name ASC
      LIMIT $4`,
    [req.tenantId, like, prefix, limit],
  )
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    `SELECT c.*,
       COALESCE(
         json_agg(n ORDER BY n.created_at DESC) FILTER (WHERE n.id IS NOT NULL),
         '[]'
       ) AS notes
     FROM contacts c
     LEFT JOIN contact_notes n ON n.contact_id = c.id AND n.tenant_id = c.tenant_id
     WHERE c.id = $1 AND c.tenant_id = $2
     GROUP BY c.id`,
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.post('/', async (req, res) => {
  const { name, email, phone, category } = req.body
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const finalCategory = VALID_CATEGORIES.has(category) ? category : 'press'
  const { rows } = await pool.query(
    `INSERT INTO contacts (tenant_id, name, email, phone, category)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [req.tenantId, String(name).trim(), email || null, phone || null, finalCategory],
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
      if (key === 'category' && !VALID_CATEGORIES.has(req.body[key])) {
        return res.status(400).json({ error: 'Invalid category value' })
      }
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key] || null)
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })
  fields.push(`updated_at = NOW()`)
  values.push(id, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE contacts SET ${fields.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM contacts WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

function requireNoteId(req, res) {
  const n = Number(req.params.noteId)
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: 'Invalid noteId' })
    return null
  }
  return n
}

router.post('/:id/notes', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const note = req.body?.note
  if (!note || !String(note).trim()) {
    return res.status(400).json({ error: 'note is required' })
  }
  const { rows } = await pool.query(
    `INSERT INTO contact_notes (contact_id, tenant_id, note)
     SELECT c.id, c.tenant_id, $3
     FROM contacts c
     WHERE c.id = $1 AND c.tenant_id = $2
     RETURNING *`,
    [id, req.tenantId, String(note).trim()],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.status(201).json(rows[0])
})

router.delete('/:id/notes/:noteId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const noteId = requireNoteId(req, res); if (noteId === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM contact_notes WHERE id = $1 AND contact_id = $2 AND tenant_id = $3',
    [noteId, id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

async function fetchExistingImportKeys(client, tenantId, names) {
  if (!names.length) return new Set()
  const { rows } = await client.query(
    `SELECT lower(name) AS name, lower(category) AS category
     FROM contacts WHERE tenant_id = $1 AND lower(name) = ANY($2)`,
    [tenantId, names],
  )
  const keys = new Set()
  for (const r of rows) keys.add(`${r.name} ${r.category}`)
  return keys
}

function normalizeImportRow(row) {
  return {
    name: String(row.name ?? '').trim(),
    email: String(row.email ?? '').trim(),
    phone: String(row.phone ?? '').trim(),
    category: VALID_CATEGORIES.has(row.category) ? row.category : 'press',
  }
}

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

    const incomingNames = [...new Set(req.body.map(r => String(r.name ?? '').trim().toLowerCase()).filter(Boolean))]
    const existingKeys = await fetchExistingImportKeys(client, req.tenantId, incomingNames)

    let imported = 0
    let skipped = 0
    const seenKeys = new Set()

    for (const row of req.body) {
      const { name, email, phone, category } = normalizeImportRow(row)
      if (!name) { skipped++; continue }

      const key = `${name.toLowerCase()} ${category.toLowerCase()}`
      if (existingKeys.has(key) || seenKeys.has(key)) { skipped++; continue }

      await client.query(
        `INSERT INTO contacts (tenant_id, name, email, phone, category) VALUES ($1, $2, $3, $4, $5)`,
        [req.tenantId, name, email || null, phone || null, category],
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
