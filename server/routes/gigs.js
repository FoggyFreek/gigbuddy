import { randomUUID } from 'crypto'
import path from 'path'
import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { sendPushToTenant, sendPushToMember } from '../utils/sendPush.js'
import { storageClient, BUCKET } from '../utils/storage.js'

const BANNER_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const router = Router()

const VALID_STATUSES = ['option', 'confirmed', 'announced']
const VALID_VOTES = ['yes', 'no']

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

function requireTaskId(req, res) {
  const taskId = parseId(req.params.taskId)
  if (taskId === null) {
    res.status(400).json({ error: 'Invalid taskId' })
    return null
  }
  return taskId
}

function requireMemberId(req, res) {
  const id = parseId(req.params.bandMemberId)
  if (id === null) {
    res.status(400).json({ error: 'Invalid bandMemberId' })
    return null
  }
  return id
}

async function loadParticipants(gigIds, tenantId) {
  if (!gigIds.length) return new Map()
  const { rows } = await pool.query(
    `SELECT gp.gig_id, gp.band_member_id, gp.vote,
            bm.name, bm.color, bm.position
     FROM gig_participants gp
     JOIN band_members bm ON bm.id = gp.band_member_id AND bm.tenant_id = $2
     WHERE gp.gig_id = ANY($1) AND gp.tenant_id = $2
     ORDER BY bm.sort_order ASC, bm.id ASC`,
    [gigIds, tenantId],
  )
  const byGig = new Map()
  for (const id of gigIds) byGig.set(id, [])
  for (const row of rows) {
    byGig.get(row.gig_id).push({
      band_member_id: row.band_member_id,
      name: row.name,
      color: row.color,
      position: row.position,
      vote: row.vote,
    })
  }
  return byGig
}

function toDateStr(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  return String(val).slice(0, 10)
}

// List all gigs with open task count and member availability
router.get('/', async (req, res) => {
  const { rows: gigs } = await pool.query(
    `SELECT
       g.*,
       COUNT(t.id) FILTER (WHERE t.done = FALSE)::int AS open_task_count
     FROM gigs g
     LEFT JOIN gig_tasks t ON t.gig_id = g.id AND t.tenant_id = $1
     WHERE g.tenant_id = $1
     GROUP BY g.id
     ORDER BY g.event_date ASC`,
    [req.tenantId],
  )

  if (!gigs.length) return res.json([])

  const { rows: members } = await pool.query(
    'SELECT * FROM band_members WHERE tenant_id = $1 ORDER BY sort_order ASC, id ASC',
    [req.tenantId],
  )

  const dates = gigs.map(g => toDateStr(g.event_date)).filter(Boolean)
  const minDate = dates.reduce((a, b) => (a < b ? a : b))
  const maxDate = dates.reduce((a, b) => (a > b ? a : b))

  const { rows: slots } = await pool.query(
    `SELECT * FROM availability_slots
     WHERE tenant_id = $1 AND start_date <= $2 AND end_date >= $3
     ORDER BY created_at ASC`,
    [req.tenantId, maxDate, minDate],
  )

  const result = gigs.map(gig => {
    const dateStr = toDateStr(gig.event_date)
    if (!dateStr) return { ...gig, members_availability: [] }

    const gigSlots = slots.filter(
      s => toDateStr(s.start_date) <= dateStr && toDateStr(s.end_date) >= dateStr,
    )
    const bandWide = gigSlots.filter(s => s.band_member_id === null).at(-1) ?? null

    const membersAvail = members.map(m => {
      const memberSlot = gigSlots.filter(s => s.band_member_id === m.id).at(-1)
      const winner = bandWide ?? memberSlot
      return {
        member_id: m.id,
        name: m.name,
        color: m.color,
        position: m.position,
        status: winner ? winner.status : 'default',
        reason: winner?.reason ?? null,
      }
    })

    return { ...gig, members_availability: membersAvail }
  })

  res.json(result)
})

// Get single gig with tasks and participants
router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows: gigs } = await pool.query(
    'SELECT * FROM gigs WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!gigs.length) return res.status(404).json({ error: 'Not found' })

  const { rows: tasks } = await pool.query(
    'SELECT * FROM gig_tasks WHERE gig_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
    [id, req.tenantId],
  )
  const byGig = await loadParticipants([id], req.tenantId)
  res.json({ ...gigs[0], tasks, participants: byGig.get(id) || [] })
})

// Create gig
router.post('/', async (req, res) => {
  const {
    event_date, event_description, venue, city, start_time, end_time, status,
    contact_name, contact_email, contact_phone,
    has_pa_system, has_drumkit,
  } = req.body
  if (!event_date || !event_description) {
    return res.status(400).json({ error: 'event_date and event_description are required' })
  }
  const finalStatus = VALID_STATUSES.includes(status) ? status : 'option'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, venue, city, start_time, end_time, status,
                         contact_name, contact_email, contact_phone,
                         has_pa_system, has_drumkit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.tenantId,
        event_date, event_description, venue || null, city || null,
        start_time || null, end_time || null, finalStatus,
        contact_name || null, contact_email || null, contact_phone || null,
        !!has_pa_system, !!has_drumkit,
      ],
    )
    const gig = rows[0]

    const { rows: leadRows } = await client.query(
      `SELECT id FROM band_members WHERE tenant_id = $1 AND position = 'lead'`,
      [req.tenantId],
    )
    for (const { id: memberId } of leadRows) {
      await client.query(
        `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id, updated_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [req.tenantId, gig.id, memberId, req.user.id],
      )
    }

    await client.query('COMMIT')
    res.status(201).json(gig)
    sendPushToTenant(req.tenantId, {
      title: 'New gig option',
      body: [gig.venue, gig.city, toDateStr(gig.event_date)].filter(Boolean).join(' · '),
      tag: 'gig-new',
      url: '/gigs',
    }).catch((err) => console.error('[push] sendPushToTenant failed', err))
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// Update gig (partial)
router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const allowed = ['event_date', 'event_description', 'venue', 'city', 'start_time', 'end_time', 'status', 'booking_fee_cents', 'notes', 'contact_name', 'contact_email', 'contact_phone', 'has_pa_system', 'has_drumkit']

  const fields = []
  const values = []
  let idx = 1

  for (const key of allowed) {
    if (key in req.body) {
      if (key === 'status' && !VALID_STATUSES.includes(req.body[key])) {
        return res.status(400).json({ error: 'Invalid status value' })
      }
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key])
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  fields.push(`updated_at = NOW()`)
  values.push(id, req.tenantId)

  const { rows } = await pool.query(
    `UPDATE gigs SET ${fields.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  const updated = rows[0]
  res.json(updated)
  if (req.body.status === 'confirmed') {
    sendPushToTenant(req.tenantId, {
      title: 'Gig confirmed!',
      body: [updated.venue, updated.city, toDateStr(updated.event_date)].filter(Boolean).join(' · '),
      tag: 'gig-confirmed',
      url: '/gigs',
    }).catch((err) => console.error('[push] sendPushToTenant failed', err))
  }
})

// Delete gig
router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT banner_path FROM gigs WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  const bannerKey = rows[0].banner_path
  const { rowCount } = await pool.query(
    'DELETE FROM gigs WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })

  if (bannerKey) {
    storageClient.removeObject(BUCKET, bannerKey).catch((e) =>
      console.warn('Failed to delete gig banner object:', e.message),
    )
  }

  res.status(204).end()
})

// --- Banner ---

// Upload / replace gig banner
router.post('/:id/banner', bannerUpload.single('banner'), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!BANNER_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }

  const { rows: before } = await pool.query(
    'SELECT banner_path FROM gigs WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!before.length) return res.status(404).json({ error: 'Not found' })
  const oldKey = before[0].banner_path

  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg'
  const objectKey = `tenants/${req.tenantId}/gig-banners/${randomUUID()}${ext}`

  await storageClient.putObject(BUCKET, objectKey, req.file.buffer, req.file.size, {
    'Content-Type': req.file.mimetype,
  })

  let updatedKey
  try {
    const { rows } = await pool.query(
      `UPDATE gigs SET banner_path = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 RETURNING banner_path`,
      [objectKey, id, req.tenantId],
    )
    updatedKey = rows[0].banner_path
  } catch (err) {
    storageClient.removeObject(BUCKET, objectKey).catch(() => {})
    throw err
  }

  if (oldKey) {
    storageClient.removeObject(BUCKET, oldKey).catch((e) =>
      console.warn('Failed to delete old gig banner object:', e.message),
    )
  }

  res.json({ banner_path: updatedKey })
})

// Delete gig banner
router.delete('/:id/banner', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT banner_path FROM gigs WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  const key = rows[0].banner_path
  await pool.query(
    'UPDATE gigs SET banner_path = NULL, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )

  if (key) {
    storageClient.removeObject(BUCKET, key).catch((e) =>
      console.warn('Failed to delete gig banner object:', e.message),
    )
  }

  res.status(204).end()
})

// --- Tasks ---

// Add task to gig
router.post('/:id/tasks', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const { title, due_date } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  const { rows: gigCheck } = await pool.query(
    'SELECT 1 FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, req.tenantId],
  )
  if (!gigCheck.length) return res.status(404).json({ error: 'Not found' })

  const { rows } = await pool.query(
    `INSERT INTO gig_tasks (tenant_id, gig_id, title, due_date)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.tenantId, gigId, title, due_date || null],
  )
  res.status(201).json(rows[0])
})

// Update task
router.patch('/:id/tasks/:taskId', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const taskId = requireTaskId(req, res); if (taskId === null) return
  const allowed = ['title', 'done', 'due_date', 'assigned_to']

  if ('assigned_to' in req.body && req.body.assigned_to !== null) {
    const assignedTo = parseId(req.body.assigned_to)
    if (assignedTo === null) {
      return res.status(400).json({ error: 'Invalid assigned_to' })
    }
    const { rows: memberRows } = await pool.query(
      'SELECT id FROM band_members WHERE id = $1 AND tenant_id = $2',
      [assignedTo, req.tenantId],
    )
    if (!memberRows.length) {
      return res.status(404).json({ error: 'assigned_to not found' })
    }
    req.body.assigned_to = assignedTo
  }

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

  values.push(taskId, gigId, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE gig_tasks SET ${fields.join(', ')}
     WHERE id = $${idx} AND gig_id = $${idx + 1} AND tenant_id = $${idx + 2} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  if (req.body.assigned_to) {
    const { rows: gigs } = await pool.query(
      'SELECT event_description FROM gigs WHERE id = $1 AND tenant_id = $2',
      [gigId, req.tenantId],
    )
    sendPushToMember(req.body.assigned_to, req.tenantId, {
      title: 'Task assigned to you',
      body: `${rows[0].title}${gigs[0]?.event_description ? ` (${gigs[0].event_description})` : ''}`,
      url: '/tasks',
    }).catch((err) => console.error('[push] task assignment notify failed', err))
  }

  res.json(rows[0])
})

// Delete task
router.delete('/:id/tasks/:taskId', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const taskId = requireTaskId(req, res); if (taskId === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM gig_tasks WHERE id = $1 AND gig_id = $2 AND tenant_id = $3',
    [taskId, gigId, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// --- Participants ---

// Add participant
router.post('/:id/participants', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const memberId = parseId(req.body.band_member_id)
  if (memberId === null) return res.status(400).json({ error: 'Invalid band_member_id' })

  const { rows: memberRows } = await pool.query(
    'SELECT id FROM band_members WHERE id = $1 AND tenant_id = $2',
    [memberId, req.tenantId],
  )
  if (!memberRows.length) return res.status(404).json({ error: 'band_member not found' })

  const { rows: gigRows } = await pool.query(
    'SELECT id FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, req.tenantId],
  )
  if (!gigRows.length) return res.status(404).json({ error: 'Not found' })

  try {
    await pool.query(
      `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4)`,
      [req.tenantId, gigId, memberId, req.user.id],
    )
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Already a participant' })
    throw err
  }

  await pool.query(
    'UPDATE gigs SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [gigId, req.tenantId],
  )
  const { rows } = await pool.query(
    'SELECT * FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, req.tenantId],
  )
  const { rows: tasks } = await pool.query(
    'SELECT * FROM gig_tasks WHERE gig_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
    [gigId, req.tenantId],
  )
  const byGig = await loadParticipants([gigId], req.tenantId)
  res.status(201).json({ ...rows[0], tasks, participants: byGig.get(gigId) || [] })
})

// Remove participant
router.delete('/:id/participants/:bandMemberId', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const memberId = requireMemberId(req, res); if (memberId === null) return

  const { rowCount } = await pool.query(
    'DELETE FROM gig_participants WHERE gig_id = $1 AND band_member_id = $2 AND tenant_id = $3',
    [gigId, memberId, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })

  await pool.query(
    'UPDATE gigs SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [gigId, req.tenantId],
  )
  res.status(204).end()
})

// Update participant vote
router.patch('/:id/participants/:bandMemberId', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const memberId = requireMemberId(req, res); if (memberId === null) return

  if (!('vote' in req.body)) return res.status(400).json({ error: 'vote is required' })
  const vote = req.body.vote
  if (vote !== null && !VALID_VOTES.includes(vote)) {
    return res.status(400).json({ error: 'Invalid vote value' })
  }

  const { rows } = await pool.query(
    `UPDATE gig_participants
     SET vote = $1, updated_by_user_id = $2, updated_at = NOW()
     WHERE gig_id = $3 AND band_member_id = $4 AND tenant_id = $5
     RETURNING *`,
    [vote, req.user.id, gigId, memberId, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  await pool.query(
    'UPDATE gigs SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [gigId, req.tenantId],
  )
  const { rows: gigRows } = await pool.query(
    'SELECT * FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, req.tenantId],
  )
  const { rows: tasks } = await pool.query(
    'SELECT * FROM gig_tasks WHERE gig_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
    [gigId, req.tenantId],
  )
  const byGig = await loadParticipants([gigId], req.tenantId)
  res.json({ ...gigRows[0], tasks, participants: byGig.get(gigId) || [] })
})

export default router
