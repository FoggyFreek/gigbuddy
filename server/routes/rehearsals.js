import { Router } from 'express'
import pool from '../db/index.js'
import { sendPushToTenant } from '../utils/sendPush.js'

const router = Router()

const VALID_STATUSES = ['option', 'planned']
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

function requireMemberId(req, res) {
  const id = parseId(req.params.bandMemberId)
  if (id === null) {
    res.status(400).json({ error: 'Invalid bandMemberId' })
    return null
  }
  return id
}

async function loadParticipants(rehearsalIds, tenantId) {
  if (!rehearsalIds.length) return new Map()
  const { rows } = await pool.query(
    `SELECT rp.rehearsal_id, rp.band_member_id, rp.vote,
            bm.name, bm.color, bm.position
     FROM rehearsal_participants rp
     JOIN band_members bm ON bm.id = rp.band_member_id AND bm.tenant_id = $2
     WHERE rp.rehearsal_id = ANY($1) AND rp.tenant_id = $2
     ORDER BY bm.sort_order ASC, bm.id ASC`,
    [rehearsalIds, tenantId],
  )
  const byRehearsal = new Map()
  for (const id of rehearsalIds) byRehearsal.set(id, [])
  for (const row of rows) {
    byRehearsal.get(row.rehearsal_id).push({
      band_member_id: row.band_member_id,
      name: row.name,
      color: row.color,
      position: row.position,
      vote: row.vote,
    })
  }
  return byRehearsal
}

async function getBandMemberIdForUser(userId, tenantId) {
  const { rows } = await pool.query(
    'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0]?.id ?? null
}

async function autoDemoteIfNeeded(rehearsalId, tenantId) {
  const { rows } = await pool.query(
    `SELECT r.status,
            BOOL_AND(rp.vote = 'yes') AS all_yes,
            COUNT(rp.id) AS n
     FROM rehearsals r
     LEFT JOIN rehearsal_participants rp
       ON rp.rehearsal_id = r.id AND rp.tenant_id = $2
     WHERE r.id = $1 AND r.tenant_id = $2
     GROUP BY r.status`,
    [rehearsalId, tenantId],
  )
  if (!rows.length) return
  const { status, all_yes, n } = rows[0]
  if (status === 'planned' && (Number(n) === 0 || all_yes !== true)) {
    await pool.query(
      `UPDATE rehearsals SET status = 'option', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [rehearsalId, tenantId],
    )
  }
}

// List all rehearsals with participants
router.get('/', async (req, res) => {
  const { rows: rehearsals } = await pool.query(
    'SELECT * FROM rehearsals WHERE tenant_id = $1 ORDER BY proposed_date ASC, id ASC',
    [req.tenantId],
  )
  if (!rehearsals.length) return res.json([])
  const byRehearsal = await loadParticipants(rehearsals.map((r) => r.id), req.tenantId)
  const result = rehearsals.map((r) => ({
    ...r,
    participants: byRehearsal.get(r.id) || [],
  }))
  res.json(result)
})

// Get single rehearsal
router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT * FROM rehearsals WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  const byRehearsal = await loadParticipants([id], req.tenantId)
  res.json({ ...rows[0], participants: byRehearsal.get(id) || [] })
})

// Create rehearsal
router.post('/', async (req, res) => {
  const { proposed_date, start_time, end_time, location, notes, extra_member_ids } = req.body
  if (!proposed_date) {
    return res.status(400).json({ error: 'proposed_date is required' })
  }
  const extras = Array.isArray(extra_member_ids)
    ? extra_member_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : []

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: insertRows } = await client.query(
      `INSERT INTO rehearsals
         (tenant_id, proposed_date, start_time, end_time, location, notes, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.tenantId,
        proposed_date,
        start_time || null,
        end_time || null,
        location || null,
        notes || null,
        req.user.id,
      ],
    )
    const rehearsal = insertRows[0]

    const { rows: leadRows } = await client.query(
      `SELECT id FROM band_members WHERE tenant_id = $1 AND position = 'lead'`,
      [req.tenantId],
    )
    const leadIds = leadRows.map((r) => r.id)

    let extraIds = []
    if (extras.length) {
      const { rows: validExtras } = await client.query(
        `SELECT id FROM band_members WHERE id = ANY($1) AND tenant_id = $2`,
        [extras, req.tenantId],
      )
      extraIds = validExtras.map((r) => r.id)
    }

    const memberIds = Array.from(new Set([...leadIds, ...extraIds]))
    const creatorMemberId = await (async () => {
      const { rows } = await client.query(
        'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2',
        [req.user.id, req.tenantId],
      )
      return rows[0]?.id ?? null
    })()

    for (const mid of memberIds) {
      const vote = mid === creatorMemberId ? 'yes' : null
      const updatedBy = mid === creatorMemberId ? req.user.id : null
      await client.query(
        `INSERT INTO rehearsal_participants
           (tenant_id, rehearsal_id, band_member_id, vote, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.tenantId, rehearsal.id, mid, vote, updatedBy],
      )
    }

    await client.query('COMMIT')

    const byRehearsal = await loadParticipants([rehearsal.id], req.tenantId)
    const result = { ...rehearsal, participants: byRehearsal.get(rehearsal.id) || [] }
    res.status(201).json(result)
    sendPushToTenant(req.tenantId, {
      title: 'New rehearsal option',
      body: [rehearsal.proposed_date?.toISOString?.().slice(0, 10) ?? rehearsal.proposed_date, rehearsal.location].filter(Boolean).join(' · '),
      tag: 'rehearsal-new',
      url: '/rehearsals',
    }).catch((err) => console.error('[push] sendPushToTenant failed', err))
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// Update rehearsal (partial)
router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const allowed = ['proposed_date', 'start_time', 'end_time', 'location', 'notes', 'status']

  if ('status' in req.body) {
    if (!VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status value' })
    }
    if (req.body.status === 'planned') {
      const { rows } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE vote IS DISTINCT FROM 'yes')::int AS not_yes,
                COUNT(*)::int AS total
         FROM rehearsal_participants WHERE rehearsal_id = $1 AND tenant_id = $2`,
        [id, req.tenantId],
      )
      const { not_yes, total } = rows[0]
      if (total === 0 || not_yes > 0) {
        return res.status(400).json({ error: 'All required participants must vote yes' })
      }
    }
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

  fields.push(`updated_at = NOW()`)
  values.push(id, req.tenantId)

  const { rows } = await pool.query(
    `UPDATE rehearsals SET ${fields.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  const byRehearsal = await loadParticipants([id], req.tenantId)
  const updated = rows[0]
  res.json({ ...updated, participants: byRehearsal.get(id) || [] })
  if (updated.status === 'planned' && req.body.status === 'planned') {
    sendPushToTenant(req.tenantId, {
      title: 'Rehearsal confirmed!',
      body: updated.proposed_date?.toISOString?.().slice(0, 10) ?? String(updated.proposed_date),
      tag: 'rehearsal-confirmed',
      url: '/rehearsals',
    }).catch((err) => console.error('[push] sendPushToTenant failed', err))
  }
})

// Delete rehearsal
router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM rehearsals WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// Add participant
router.post('/:id/participants', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const memberId = parseId(req.body.band_member_id)
  if (memberId === null) return res.status(400).json({ error: 'Invalid band_member_id' })

  const { rows: memberRows } = await pool.query(
    'SELECT id FROM band_members WHERE id = $1 AND tenant_id = $2',
    [memberId, req.tenantId],
  )
  if (!memberRows.length) return res.status(404).json({ error: 'band_member not found' })

  const { rows: rehRows } = await pool.query(
    'SELECT id FROM rehearsals WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rehRows.length) return res.status(404).json({ error: 'Not found' })

  const creatorMemberId = await getBandMemberIdForUser(req.user.id, req.tenantId)
  const vote = memberId === creatorMemberId ? 'yes' : null
  const updatedBy = memberId === creatorMemberId ? req.user.id : null

  try {
    await pool.query(
      `INSERT INTO rehearsal_participants
         (tenant_id, rehearsal_id, band_member_id, vote, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.tenantId, id, memberId, vote, updatedBy],
    )
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already a participant' })
    }
    throw err
  }

  await pool.query(
    'UPDATE rehearsals SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  await autoDemoteIfNeeded(id, req.tenantId)

  const { rows } = await pool.query(
    'SELECT * FROM rehearsals WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  const byRehearsal = await loadParticipants([id], req.tenantId)
  res.status(201).json({ ...rows[0], participants: byRehearsal.get(id) || [] })
})

// Remove participant
router.delete('/:id/participants/:bandMemberId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const memberId = requireMemberId(req, res); if (memberId === null) return

  const { rowCount } = await pool.query(
    `DELETE FROM rehearsal_participants
     WHERE rehearsal_id = $1 AND band_member_id = $2 AND tenant_id = $3`,
    [id, memberId, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })

  await pool.query(
    'UPDATE rehearsals SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  res.status(204).end()
})

// Update vote
router.patch('/:id/participants/:bandMemberId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const memberId = requireMemberId(req, res); if (memberId === null) return

  if (!('vote' in req.body)) return res.status(400).json({ error: 'vote is required' })
  const vote = req.body.vote
  if (vote !== null && !VALID_VOTES.includes(vote)) {
    return res.status(400).json({ error: 'Invalid vote value' })
  }

  const { rows } = await pool.query(
    `UPDATE rehearsal_participants
     SET vote = $1, updated_by_user_id = $2, updated_at = NOW()
     WHERE rehearsal_id = $3 AND band_member_id = $4 AND tenant_id = $5
     RETURNING *`,
    [vote, req.user.id, id, memberId, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  await pool.query(
    'UPDATE rehearsals SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  await autoDemoteIfNeeded(id, req.tenantId)

  const { rows: rehRows } = await pool.query(
    'SELECT * FROM rehearsals WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  const byRehearsal = await loadParticipants([id], req.tenantId)
  res.json({ ...rehRows[0], participants: byRehearsal.get(id) || [] })
})

export default router
