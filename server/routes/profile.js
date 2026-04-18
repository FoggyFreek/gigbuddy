import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const PROFILE_FIELDS = [
  'band_name',
  'bio',
  'instagram_handle',
  'facebook_handle',
  'tiktok_handle',
  'youtube_handle',
  'spotify_handle',
]

const LINK_FIELDS = ['label', 'url', 'sort_order']

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function requireLinkId(req, res) {
  const linkId = parseId(req.params.linkId)
  if (linkId === null) {
    res.status(400).json({ error: 'Invalid linkId' })
    return null
  }
  return linkId
}

// Get singleton profile with its links
router.get('/', async (_req, res) => {
  const { rows: profiles } = await pool.query('SELECT * FROM profile WHERE id = 1')
  if (!profiles.length) return res.status(404).json({ error: 'Profile not found' })

  const { rows: links } = await pool.query(
    'SELECT * FROM profile_links WHERE profile_id = 1 ORDER BY sort_order ASC, id ASC'
  )
  res.json({ ...profiles[0], links })
})

// Update profile (partial)
router.patch('/', async (req, res) => {
  const fields = []
  const values = []
  let idx = 1

  for (const key of PROFILE_FIELDS) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key])
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  fields.push(`updated_at = NOW()`)

  const { rows } = await pool.query(
    `UPDATE profile SET ${fields.join(', ')} WHERE id = 1 RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Profile not found' })
  res.json(rows[0])
})

// Create link
router.post('/links', async (req, res) => {
  const { label, url } = req.body
  if (!label || !url) {
    return res.status(400).json({ error: 'label and url are required' })
  }

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM profile_links WHERE profile_id = 1'
  )
  const nextOrder = maxRows[0].next

  const { rows } = await pool.query(
    `INSERT INTO profile_links (profile_id, label, url, sort_order)
     VALUES (1, $1, $2, $3) RETURNING *`,
    [label, url, nextOrder]
  )
  res.status(201).json(rows[0])
})

// Update link (partial)
router.patch('/links/:linkId', async (req, res) => {
  const linkId = requireLinkId(req, res); if (linkId === null) return

  const fields = []
  const values = []
  let idx = 1

  for (const key of LINK_FIELDS) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key])
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  values.push(linkId)
  const { rows } = await pool.query(
    `UPDATE profile_links SET ${fields.join(', ')} WHERE id = $${idx} AND profile_id = 1 RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

// Delete link
router.delete('/links/:linkId', async (req, res) => {
  const linkId = requireLinkId(req, res); if (linkId === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM profile_links WHERE id = $1 AND profile_id = 1',
    [linkId]
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
