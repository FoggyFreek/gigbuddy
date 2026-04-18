import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const VALID_STATUSES = ['option', 'confirmed', 'announced']

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

function toDateStr(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  return String(val).slice(0, 10)
}

// List all gigs with open task count and member availability
router.get('/', async (_req, res) => {
  const { rows: gigs } = await pool.query(`
    SELECT
      g.*,
      COUNT(t.id) FILTER (WHERE t.done = FALSE)::int AS open_task_count
    FROM gigs g
    LEFT JOIN gig_tasks t ON t.gig_id = g.id
    GROUP BY g.id
    ORDER BY g.event_date ASC
  `)

  if (!gigs.length) return res.json([])

  const { rows: members } = await pool.query(
    'SELECT * FROM band_members ORDER BY sort_order ASC, id ASC'
  )

  const dates = gigs.map(g => toDateStr(g.event_date)).filter(Boolean)
  const minDate = dates.reduce((a, b) => (a < b ? a : b))
  const maxDate = dates.reduce((a, b) => (a > b ? a : b))

  const { rows: slots } = await pool.query(
    'SELECT * FROM availability_slots WHERE start_date <= $1 AND end_date >= $2 ORDER BY created_at ASC',
    [maxDate, minDate]
  )

  const result = gigs.map(gig => {
    const dateStr = toDateStr(gig.event_date)
    if (!dateStr) return { ...gig, members_availability: [] }

    const gigSlots = slots.filter(
      s => toDateStr(s.start_date) <= dateStr && toDateStr(s.end_date) >= dateStr
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

// Get single gig with tasks
router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows: gigs } = await pool.query('SELECT * FROM gigs WHERE id = $1', [id])
  if (!gigs.length) return res.status(404).json({ error: 'Not found' })

  const { rows: tasks } = await pool.query(
    'SELECT * FROM gig_tasks WHERE gig_id = $1 ORDER BY created_at ASC',
    [id]
  )
  res.json({ ...gigs[0], tasks })
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

  const { rows } = await pool.query(
    `INSERT INTO gigs (event_date, event_description, venue, city, start_time, end_time, status,
                       contact_name, contact_email, contact_phone,
                       has_pa_system, has_drumkit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      event_date, event_description, venue || null, city || null,
      start_time || null, end_time || null, finalStatus,
      contact_name || null, contact_email || null, contact_phone || null,
      !!has_pa_system, !!has_drumkit,
    ]
  )
  res.status(201).json(rows[0])
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
  values.push(id)

  const { rows } = await pool.query(
    `UPDATE gigs SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

// Delete gig
router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query('DELETE FROM gigs WHERE id = $1', [id])
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// --- Tasks ---

// Add task to gig
router.post('/:id/tasks', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const { title, due_date } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  const { rows } = await pool.query(
    `INSERT INTO gig_tasks (gig_id, title, due_date) VALUES ($1, $2, $3) RETURNING *`,
    [gigId, title, due_date || null]
  )
  res.status(201).json(rows[0])
})

// Update task
router.patch('/:id/tasks/:taskId', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const taskId = requireTaskId(req, res); if (taskId === null) return
  const allowed = ['title', 'done', 'due_date']

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

  values.push(taskId, gigId)
  const { rows } = await pool.query(
    `UPDATE gig_tasks SET ${fields.join(', ')} WHERE id = $${idx} AND gig_id = $${idx + 1} RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

// Delete task
router.delete('/:id/tasks/:taskId', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const taskId = requireTaskId(req, res); if (taskId === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM gig_tasks WHERE id = $1 AND gig_id = $2',
    [taskId, gigId]
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
