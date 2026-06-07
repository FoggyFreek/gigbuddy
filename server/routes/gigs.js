import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { safeRemove } from '../services/storageService.js'
import {
  parseId,
  toDateStr,
  VALID_STATUSES,
  VALID_VOTES,
} from '../validators/gigValidators.js'
import {
  VENUE_JSON_SELECT,
  FESTIVAL_JSON_SELECT,
  VENUE_JOIN,
  FESTIVAL_JOIN,
  assertVenueInTenant,
  loadParticipants,
  fetchGigWithRelations,
  gigExistsInTenant,
  memberExistsInTenant,
} from '../repositories/gigRepository.js'
import {
  patchGig,
  patchGigTask,
  replaceGigBanner,
  deleteGigBanner,
  createGigAttachment,
  notifyGigCreated,
  notifyGigConfirmed,
  notifyGigsImported,
} from '../services/gigService.js'

const BANNER_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const ATTACHMENT_ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
])
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
})

const router = Router()

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

// List all gigs with open task count and member availability
router.get('/', async (req, res) => {
  const { rows: gigs } = await pool.query(
    `SELECT
       g.*,
       (
         SELECT COUNT(*)::int
           FROM gig_tasks t
          WHERE t.gig_id = g.id
            AND t.tenant_id = g.tenant_id
            AND t.done = FALSE
       ) AS open_task_count,
       ${VENUE_JSON_SELECT},
       ${FESTIVAL_JSON_SELECT}
     FROM gigs g
     ${VENUE_JOIN}
     ${FESTIVAL_JOIN}
     WHERE g.tenant_id = $1
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
    const bandWide = gigSlots.findLast(s => s.band_member_id === null) ?? null

    const membersAvail = members.map(m => {
      const memberSlot = gigSlots.findLast(s => s.band_member_id === m.id)
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
  const gig = await fetchGigWithRelations(pool, id, req.tenantId)
  if (!gig) return res.status(404).json({ error: 'Not found' })

  const { rows: tasks } = await pool.query(
    'SELECT * FROM gig_tasks WHERE gig_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
    [id, req.tenantId],
  )
  const { rows: attachments } = await pool.query(
    `SELECT id, object_key, original_filename, content_type, file_size, uploaded_at
     FROM gig_attachments WHERE gig_id = $1 AND tenant_id = $2 ORDER BY uploaded_at ASC`,
    [id, req.tenantId],
  )
  const byGig = await loadParticipants(pool, [id], req.tenantId)
  res.json({ ...gig, tasks, participants: byGig.get(id) || [], attachments })
})

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// Validate and normalize a single import row. Returns one of:
//   { skip: true }        — row is missing required fields, count as skipped
//   { error: '...' }      — row is invalid, the import should abort with 400
//   { data: {...} }       — normalized, ready-to-insert column values
function normalizeImportRow(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item))
    return { error: 'Each import row must be an object' }

  const {
    event_date, event_description, venue_id, festival_id,
    start_time, end_time, status, admission, event_link, ticket_link,
  } = item

  if (!event_date || !event_description) return { skip: true }

  if (!DATE_RE.test(event_date)) return { error: `Invalid event_date: ${event_date}` }
  if (start_time && !TIME_RE.test(start_time)) return { error: `Invalid start_time: ${start_time}` }
  if (end_time && !TIME_RE.test(end_time)) return { error: `Invalid end_time: ${end_time}` }

  let venueId = null
  if (venue_id != null) {
    venueId = parseId(venue_id)
    if (venueId === null) return { error: 'Invalid venue_id' }
  }
  let festivalId = null
  if (festival_id != null) {
    festivalId = parseId(festival_id)
    if (festivalId === null) return { error: 'Invalid festival_id' }
  }

  let finalStatus = 'confirmed'
  if (status != null) {
    if (!VALID_STATUSES.includes(status)) return { error: `Invalid status: ${status}` }
    finalStatus = status
  }

  return {
    data: {
      event_date, event_description, venueId, festivalId,
      start_time: start_time || null, end_time: end_time || null,
      status: finalStatus, admission: admission === 'paid' ? 'paid' : 'free',
      event_link: event_link || null, ticket_link: ticket_link || null,
    },
  }
}

// Bulk import gigs from Bandsintown CSV export
router.post('/import', async (req, res) => {
  const body = req.body
  if (!Array.isArray(body) || body.length === 0)
    return res.status(400).json({ error: 'Expected non-empty array' })
  if (body.length > 200)
    return res.status(400).json({ error: 'Maximum 200 gigs per import' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: leadRows } = await client.query(
      `SELECT id FROM band_members WHERE tenant_id = $1 AND position = 'lead'`,
      [req.tenantId],
    )

    let created = 0
    let skipped = 0

    for (const item of body) {
      const parsed = normalizeImportRow(item)
      if (parsed.error) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: parsed.error })
      }
      if (parsed.skip) { skipped++; continue }
      const row = parsed.data

      try {
        await assertVenueInTenant(client, row.venueId, req.tenantId, 'venue')
        await assertVenueInTenant(client, row.festivalId, req.tenantId, 'festival')
      } catch (err) {
        if (err.status === 400) {
          await client.query('ROLLBACK')
          return res.status(400).json({ error: err.message })
        }
        throw err
      }

      const { rows: gigRows } = await client.query(
        `INSERT INTO gigs (tenant_id, event_date, event_description, venue_id, festival_id,
           start_time, end_time, status, admission, event_link, ticket_link)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          req.tenantId, row.event_date, row.event_description, row.venueId, row.festivalId,
          row.start_time, row.end_time, row.status, row.admission,
          row.event_link, row.ticket_link,
        ],
      )
      const gigId = gigRows[0].id

      for (const { id: memberId } of leadRows) {
        await client.query(
          `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id, updated_by_user_id)
           VALUES ($1,$2,$3,$4)`,
          [req.tenantId, gigId, memberId, req.user.id],
        )
      }
      created++
    }

    await client.query('COMMIT')
    res.status(201).json({ created, skipped })
    if (created > 0) notifyGigsImported(req.tenantId, created)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// Create gig
router.post('/', async (req, res) => {
  const {
    event_date, event_description, venue_id, festival_id, start_time, end_time, status,
    has_pa_system, has_drumkit, has_stage_lights,
  } = req.body
  if (!event_date || !event_description) {
    return res.status(400).json({ error: 'event_date and event_description are required' })
  }
  let venueId = null
  if (venue_id !== undefined && venue_id !== null) {
    venueId = parseId(venue_id)
    if (venueId === null) return res.status(400).json({ error: 'Invalid venue_id' })
  }
  let festivalId = null
  if (festival_id !== undefined && festival_id !== null) {
    festivalId = parseId(festival_id)
    if (festivalId === null) return res.status(400).json({ error: 'Invalid festival_id' })
  }
  const finalStatus = VALID_STATUSES.includes(status) ? status : 'option'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    try {
      await assertVenueInTenant(client, venueId, req.tenantId, 'venue')
      await assertVenueInTenant(client, festivalId, req.tenantId, 'festival')
    } catch (err) {
      if (err.status === 400) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: err.message })
      }
      throw err
    }

    const { rows } = await client.query(
      `WITH inserted AS (
         INSERT INTO gigs (tenant_id, event_date, event_description, venue_id, festival_id, start_time, end_time, status,
                           has_pa_system, has_drumkit, has_stage_lights)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *
       )
       SELECT g.*, ${VENUE_JSON_SELECT}, ${FESTIVAL_JSON_SELECT}
         FROM inserted g
         ${VENUE_JOIN}
         ${FESTIVAL_JOIN}`,
      [
        req.tenantId,
        event_date, event_description, venueId, festivalId,
        start_time || null, end_time || null, finalStatus,
        !!has_pa_system, !!has_drumkit, !!has_stage_lights,
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
    notifyGigCreated(req.tenantId, gig)
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
  const body = req.body || {}

  const result = await patchGig(pool, req.tenantId, id, body)
  if (result.error) return res.status(result.error.status).json(result.error.body)

  res.json(result.gig)
  if (body.status === 'confirmed') {
    notifyGigConfirmed(req.tenantId, result.gig)
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

  safeRemove(bannerKey, 'Failed to delete gig banner object:')

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

  const result = await replaceGigBanner({ db: pool, tenantId: req.tenantId, gigId: id, file: req.file })
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json({ banner_path: result.bannerPath })
})

// Delete gig banner
router.delete('/:id/banner', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await deleteGigBanner({ db: pool, tenantId: req.tenantId, gigId: id })
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(204).end()
})

// --- Attachments ---

router.post('/:id/attachments', attachmentUpload.single('file'), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!ATTACHMENT_ALLOWED_TYPES.has(req.file.mimetype))
    return res.status(400).json({ error: 'File type not allowed' })

  const result = await createGigAttachment({ db: pool, tenantId: req.tenantId, gigId: id, file: req.file })
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(201).json(result.attachment)
})

router.delete('/:id/attachments/:attachmentId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const attachmentId = parseId(req.params.attachmentId)
  if (attachmentId === null) return res.status(400).json({ error: 'Invalid attachmentId' })

  const { rows } = await pool.query(
    'DELETE FROM gig_attachments WHERE id = $1 AND gig_id = $2 AND tenant_id = $3 RETURNING object_key',
    [attachmentId, id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  safeRemove(rows[0].object_key, 'Failed to delete gig attachment object:')

  res.status(204).end()
})

// --- Tasks ---

// Add task to gig
router.post('/:id/tasks', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const { title, due_date } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  if (!(await gigExistsInTenant(pool, gigId, req.tenantId))) {
    return res.status(404).json({ error: 'Not found' })
  }

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
  const body = req.body || {}

  const result = await patchGigTask(pool, req.tenantId, gigId, taskId, body)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.task)
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

  if (!(await memberExistsInTenant(pool, memberId, req.tenantId))) {
    return res.status(404).json({ error: 'band_member not found' })
  }
  if (!(await gigExistsInTenant(pool, gigId, req.tenantId))) {
    return res.status(404).json({ error: 'Not found' })
  }

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
  const gig = await fetchGigWithRelations(pool, gigId, req.tenantId)
  const { rows: tasks } = await pool.query(
    'SELECT * FROM gig_tasks WHERE gig_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
    [gigId, req.tenantId],
  )
  const byGig = await loadParticipants(pool, [gigId], req.tenantId)
  res.status(201).json({ ...gig, tasks, participants: byGig.get(gigId) || [] })
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
  const gig = await fetchGigWithRelations(pool, gigId, req.tenantId)
  const { rows: tasks } = await pool.query(
    'SELECT * FROM gig_tasks WHERE gig_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
    [gigId, req.tenantId],
  )
  const byGig = await loadParticipants(pool, [gigId], req.tenantId)
  res.json({ ...gig, tasks, participants: byGig.get(gigId) || [] })
})

// --- Gig contacts (mirrors venue_contacts; links are informational) ---

async function getContactInTenant(tenantId, contactId) {
  const { rows } = await pool.query(
    'SELECT id, name, email, phone, category FROM contacts WHERE id = $1 AND tenant_id = $2',
    [contactId, tenantId],
  )
  return rows[0] ?? null
}

router.get('/:id/contacts', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  if (!(await gigExistsInTenant(pool, gigId, req.tenantId))) {
    return res.status(404).json({ error: 'Not found' })
  }

  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.email, c.phone, c.category, gc.is_primary
       FROM gig_contacts gc
       JOIN contacts c ON c.id = gc.contact_id AND c.tenant_id = gc.tenant_id
      WHERE gc.gig_id = $1 AND gc.tenant_id = $2
      ORDER BY gc.is_primary DESC, c.name ASC`,
    [gigId, req.tenantId],
  )
  res.json(rows)
})

router.post('/:id/contacts', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const contactId = parseId(req.body.contact_id)
  if (contactId === null) return res.status(400).json({ error: 'contact_id is required' })

  if (!(await gigExistsInTenant(pool, gigId, req.tenantId))) {
    return res.status(404).json({ error: 'Not found' })
  }
  const contact = await getContactInTenant(req.tenantId, contactId)
  if (!contact) return res.status(404).json({ error: 'Not found' })

  try {
    await pool.query(
      'INSERT INTO gig_contacts (gig_id, contact_id, tenant_id) VALUES ($1, $2, $3)',
      [gigId, contactId, req.tenantId],
    )
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Contact is already linked to this gig' })
    throw err
  }
  res.status(201).json({ ...contact, is_primary: false })
})

router.patch('/:id/contacts/:contactId', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const contactId = parseId(req.params.contactId)
  if (contactId === null) return res.status(400).json({ error: 'Invalid contactId' })

  if (typeof req.body.is_primary !== 'boolean') {
    return res.status(400).json({ error: 'is_primary (boolean) is required' })
  }
  const makePrimary = req.body.is_primary

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: links } = await client.query(
      'SELECT contact_id FROM gig_contacts WHERE gig_id = $1 AND tenant_id = $2 FOR UPDATE',
      [gigId, req.tenantId],
    )
    if (!links.some((link) => link.contact_id === contactId)) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Not found' })
    }

    if (makePrimary) {
      await client.query(
        'UPDATE gig_contacts SET is_primary = false WHERE gig_id = $1 AND tenant_id = $2 AND is_primary',
        [gigId, req.tenantId],
      )
    }

    const { rows } = await client.query(
      `UPDATE gig_contacts SET is_primary = $3
        WHERE gig_id = $1 AND contact_id = $2 AND tenant_id = $4
        RETURNING contact_id, is_primary`,
      [gigId, contactId, makePrimary, req.tenantId],
    )
    await client.query('COMMIT')
    res.json(rows[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23505') return res.status(409).json({ error: 'Another contact is already primary' })
    throw err
  } finally {
    client.release()
  }
})

router.delete('/:id/contacts/:contactId', async (req, res) => {
  const gigId = requireId(req, res); if (gigId === null) return
  const contactId = parseId(req.params.contactId)
  if (contactId === null) return res.status(400).json({ error: 'Invalid contactId' })

  const { rowCount } = await pool.query(
    'DELETE FROM gig_contacts WHERE gig_id = $1 AND contact_id = $2 AND tenant_id = $3',
    [gigId, contactId, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
