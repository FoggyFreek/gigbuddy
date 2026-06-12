import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { safeRemove } from '../services/storageService.js'
import { createSongDocument, createSongRecording } from '../services/songService.js'

const router = Router()

const DOCUMENT_ALLOWED_TYPES = new Set(['application/pdf'])
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const RECORDING_ALLOWED_TYPES = new Set(['audio/mpeg'])
const recordingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

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

// Coerce a body value to a non-negative integer or null.
function toIntOrNull(val) {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isInteger(n) && n >= 0 ? n : null
}

function trimOrNull(val) {
  const s = String(val ?? '').trim()
  return s ? s : null
}

// ---------- songs ----------

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*,
       COALESCE(
         json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
           FILTER (WHERE t.id IS NOT NULL),
         '[]'
       ) AS tags
     FROM songs s
     LEFT JOIN song_tag_links l ON l.song_id = s.id AND l.tenant_id = s.tenant_id
     LEFT JOIN song_tags t ON t.id = l.tag_id AND t.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1
     GROUP BY s.id
     ORDER BY s.title ASC`,
    [req.tenantId],
  )
  res.json(rows)
})

// Must be registered before GET /:id, or '/tags' is captured by ':id'.
router.get('/tags', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  const params = [req.tenantId]
  let where = 'WHERE tenant_id = $1'
  if (q) {
    params.push(`%${q}%`)
    where += ` AND name ILIKE $2`
  }
  const { rows } = await pool.query(
    `SELECT id, name FROM song_tags ${where} ORDER BY name ASC LIMIT 100`,
    params,
  )
  res.json(rows)
})

// Must also be registered before GET /:id.
router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 3) return res.json([])
  const like = `%${q}%`
  const { rows } = await pool.query(
    `SELECT id, title, artist
       FROM songs
      WHERE tenant_id = $1 AND (title ILIKE $2 OR artist ILIKE $2)
      ORDER BY
        CASE WHEN title ILIKE $2 THEN 0 ELSE 1 END,
        title ASC
      LIMIT 10`,
    [req.tenantId, like],
  )
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  // Separate queries per child collection — a single multi-LEFT-JOIN would
  // produce cross-product duplicates across tags/links/documents/recordings.
  const { rows: base } = await pool.query(
    'SELECT * FROM songs WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!base.length) return res.status(404).json({ error: 'Not found' })

  const [tags, links, documents, recordings] = await Promise.all([
    pool.query(
      `SELECT t.id, t.name
         FROM song_tag_links l
         JOIN song_tags t ON t.id = l.tag_id AND t.tenant_id = l.tenant_id
        WHERE l.song_id = $1 AND l.tenant_id = $2
        ORDER BY t.name ASC`,
      [id, req.tenantId],
    ),
    pool.query(
      `SELECT id, label, url, sort_order
         FROM song_links WHERE song_id = $1 AND tenant_id = $2
        ORDER BY sort_order ASC, id ASC`,
      [id, req.tenantId],
    ),
    pool.query(
      `SELECT id, object_key, original_filename, content_type, file_size, uploaded_at
         FROM song_documents WHERE song_id = $1 AND tenant_id = $2
        ORDER BY uploaded_at ASC`,
      [id, req.tenantId],
    ),
    pool.query(
      `SELECT id, object_key, original_filename, content_type, file_size, uploaded_at
         FROM song_recordings WHERE song_id = $1 AND tenant_id = $2
        ORDER BY uploaded_at ASC`,
      [id, req.tenantId],
    ),
  ])

  res.json({
    ...base[0],
    tags: tags.rows,
    links: links.rows,
    documents: documents.rows,
    recordings: recordings.rows,
  })
})

router.post('/', async (req, res) => {
  const title = trimOrNull(req.body.title)
  if (!title) return res.status(400).json({ error: 'title is required' })
  const { rows } = await pool.query(
    `INSERT INTO songs (tenant_id, title, artist, song_key, tempo, duration_seconds, lyrics_html, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      req.tenantId,
      title,
      trimOrNull(req.body.artist),
      trimOrNull(req.body.song_key),
      toIntOrNull(req.body.tempo),
      toIntOrNull(req.body.duration_seconds),
      req.body.lyrics_html ?? null,
      trimOrNull(req.body.notes),
    ],
  )
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const textFields = ['artist', 'song_key', 'lyrics_html', 'notes']
  const intFields = ['tempo', 'duration_seconds']
  const fields = []
  const values = []
  let idx = 1

  if ('title' in req.body) {
    const title = trimOrNull(req.body.title)
    if (!title) return res.status(400).json({ error: 'title is required' })
    fields.push(`title = $${idx++}`)
    values.push(title)
  }
  for (const key of textFields) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(key === 'lyrics_html' ? (req.body[key] ?? null) : trimOrNull(req.body[key]))
    }
  }
  for (const key of intFields) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(toIntOrNull(req.body[key]))
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  fields.push(`updated_at = NOW()`)
  values.push(id, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE songs SET ${fields.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  // Collect object keys first, delete the row (cascade clears child rows), then
  // remove the objects. Never remove objects before the DB delete commits.
  const { rows: keys } = await pool.query(
    `SELECT object_key FROM song_documents WHERE song_id = $1 AND tenant_id = $2
     UNION ALL
     SELECT object_key FROM song_recordings WHERE song_id = $1 AND tenant_id = $2`,
    [id, req.tenantId],
  )
  const { rowCount } = await pool.query(
    'DELETE FROM songs WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  for (const { object_key } of keys) {
    safeRemove(object_key, 'Failed to delete song file object:')
  }
  res.status(204).end()
})

// ---------- tags ----------

// Replace a song's tag set. Find-or-create each tag (case-insensitive) and rewrite
// the join rows, all in one transaction.
router.put('/:id/tags', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  if (!Array.isArray(req.body?.tags)) {
    return res.status(400).json({ error: 'tags must be an array' })
  }
  const names = [...new Set(
    req.body.tags.map((t) => String(t ?? '').trim()).filter(Boolean),
  )]

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: songRows } = await client.query(
      'SELECT 1 FROM songs WHERE id = $1 AND tenant_id = $2',
      [id, req.tenantId],
    )
    if (!songRows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Not found' })
    }

    const tagIds = []
    for (const name of names) {
      const { rows } = await client.query(
        `INSERT INTO song_tags (tenant_id, name) VALUES ($1, $2)
         ON CONFLICT (tenant_id, lower(name)) DO UPDATE SET name = song_tags.name
         RETURNING id`,
        [req.tenantId, name],
      )
      tagIds.push(rows[0].id)
    }

    await client.query(
      'DELETE FROM song_tag_links WHERE song_id = $1 AND tenant_id = $2',
      [id, req.tenantId],
    )
    for (const tagId of tagIds) {
      await client.query(
        'INSERT INTO song_tag_links (song_id, tag_id, tenant_id) VALUES ($1, $2, $3)',
        [id, tagId, req.tenantId],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const { rows } = await pool.query(
    `SELECT t.id, t.name
       FROM song_tag_links l
       JOIN song_tags t ON t.id = l.tag_id AND t.tenant_id = l.tenant_id
      WHERE l.song_id = $1 AND l.tenant_id = $2
      ORDER BY t.name ASC`,
    [id, req.tenantId],
  )
  res.json(rows)
})

// ---------- links ----------

function requireLinkId(req, res) {
  const n = parseId(req.params.linkId)
  if (n === null) {
    res.status(400).json({ error: 'Invalid linkId' })
    return null
  }
  return n
}

router.post('/:id/links', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const url = trimOrNull(req.body.url)
  if (!url) return res.status(400).json({ error: 'url is required' })

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM song_links WHERE song_id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  const { rows } = await pool.query(
    `INSERT INTO song_links (song_id, tenant_id, label, url, sort_order)
     SELECT s.id, s.tenant_id, $3, $4, $5
     FROM songs s WHERE s.id = $1 AND s.tenant_id = $2
     RETURNING id, label, url, sort_order`,
    [id, req.tenantId, trimOrNull(req.body.label), url, maxRows[0].next],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.status(201).json(rows[0])
})

router.patch('/:id/links/:linkId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const linkId = requireLinkId(req, res); if (linkId === null) return

  const fields = []
  const values = []
  let idx = 1
  if ('label' in req.body) { fields.push(`label = $${idx++}`); values.push(trimOrNull(req.body.label)) }
  if ('url' in req.body) {
    const url = trimOrNull(req.body.url)
    if (!url) return res.status(400).json({ error: 'url cannot be empty' })
    fields.push(`url = $${idx++}`); values.push(url)
  }
  if ('sort_order' in req.body) {
    const so = toIntOrNull(req.body.sort_order)
    if (so === null) return res.status(400).json({ error: 'Invalid sort_order' })
    fields.push(`sort_order = $${idx++}`); values.push(so)
  }
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  values.push(linkId, id, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE song_links SET ${fields.join(', ')}
     WHERE id = $${idx} AND song_id = $${idx + 1} AND tenant_id = $${idx + 2}
     RETURNING id, label, url, sort_order`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id/links/:linkId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const linkId = requireLinkId(req, res); if (linkId === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM song_links WHERE id = $1 AND song_id = $2 AND tenant_id = $3',
    [linkId, id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// ---------- documents (pdf) ----------

router.post('/:id/documents', documentUpload.single('file'), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!DOCUMENT_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }
  const result = await createSongDocument({ db: pool, tenantId: req.tenantId, songId: id, file: req.file })
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(201).json(result.document)
})

router.delete('/:id/documents/:docId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const docId = parseId(req.params.docId)
  if (docId === null) return res.status(400).json({ error: 'Invalid docId' })
  const { rows } = await pool.query(
    'DELETE FROM song_documents WHERE id = $1 AND song_id = $2 AND tenant_id = $3 RETURNING object_key',
    [docId, id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  safeRemove(rows[0].object_key, 'Failed to delete song document object:')
  res.status(204).end()
})

// ---------- recordings (mp3) ----------

router.post('/:id/recordings', recordingUpload.single('file'), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!RECORDING_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }
  const result = await createSongRecording({ db: pool, tenantId: req.tenantId, songId: id, file: req.file })
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(201).json(result.recording)
})

router.delete('/:id/recordings/:recId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const recId = parseId(req.params.recId)
  if (recId === null) return res.status(400).json({ error: 'Invalid recId' })
  const { rows } = await pool.query(
    'DELETE FROM song_recordings WHERE id = $1 AND song_id = $2 AND tenant_id = $3 RETURNING object_key',
    [recId, id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  safeRemove(rows[0].object_key, 'Failed to delete song recording object:')
  res.status(204).end()
})

// ---------- import ----------

function normalizeImportRow(row) {
  return {
    title: String(row.title ?? '').trim(),
    artist: String(row.artist ?? '').trim(),
    song_key: String(row.song_key ?? row.key ?? '').trim(),
    tempo: toIntOrNull(row.tempo),
    duration_seconds: toIntOrNull(row.duration_seconds ?? row.duration),
    tags: String(row.tags ?? '')
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean),
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

    const { rows: existingRows } = await client.query(
      'SELECT lower(title) AS title, lower(coalesce(artist, \'\')) AS artist FROM songs WHERE tenant_id = $1',
      [req.tenantId],
    )
    const existingKeys = new Set(existingRows.map((r) => `${r.title} ${r.artist}`))

    let imported = 0
    let skipped = 0
    const seenKeys = new Set()

    for (const raw of req.body) {
      const row = normalizeImportRow(raw)
      if (!row.title) { skipped++; continue }
      const key = `${row.title.toLowerCase()} ${row.artist.toLowerCase()}`
      if (existingKeys.has(key) || seenKeys.has(key)) { skipped++; continue }

      const { rows: inserted } = await client.query(
        `INSERT INTO songs (tenant_id, title, artist, song_key, tempo, duration_seconds)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.tenantId, row.title, row.artist || null, row.song_key || null, row.tempo, row.duration_seconds],
      )
      const songId = inserted[0].id

      for (const name of [...new Set(row.tags)]) {
        const { rows: tagRows } = await client.query(
          `INSERT INTO song_tags (tenant_id, name) VALUES ($1, $2)
           ON CONFLICT (tenant_id, lower(name)) DO UPDATE SET name = song_tags.name
           RETURNING id`,
          [req.tenantId, name],
        )
        await client.query(
          `INSERT INTO song_tag_links (song_id, tag_id, tenant_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [songId, tagRows[0].id, req.tenantId],
        )
      }

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
