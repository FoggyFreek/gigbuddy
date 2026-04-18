import { Router } from 'express'
import pool from '../db/index.js'

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

async function loadParticipants(rehearsalIds) {
  if (!rehearsalIds.length) return new Map()
  const { rows } = await pool.query(
    `SELECT rp.rehearsal_id, rp.band_member_id, rp.vote,
            bm.name, bm.color, bm.position
     FROM rehearsal_participants rp
     JOIN band_members bm ON bm.id = rp.band_member_id
     WHERE rp.rehearsal_id = ANY($1)
     ORDER BY bm.sort_order ASC, bm.id ASC`,
    [rehearsalIds]
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

async function getBandMemberIdForUser(userId) {
  const { rows } = await pool.query(
    'SELECT id FROM band_members WHERE user_id = $1',
    [userId]
  )
  return rows[0]?.id ?? null
}

async function autoDemoteIfNeeded(rehearsalId) {
  const { rows } = await pool.query(
    `SELECT r.status,
            BOOL_AND(rp.vote = 'yes') AS all_yes,
            COUNT(rp.id) AS n
     FROM rehearsals r
     LEFT JOIN rehearsal_participants rp ON rp.rehearsal_id = r.id
     WHERE r.id = $1
     GROUP BY r.status`,
    [rehearsalId]
  )
  if (!rows.length) return
  const { status, all_yes, n } = rows[0]
  if (status === 'planned' && (Number(n) === 0 || all_yes !== true)) {
    await pool.query(
      `UPDATE rehearsals SET status = 'option', updated_at = NOW() WHERE id = $1`,
      [rehearsalId]
    )
  }
}

// List all rehearsals with participants
router.get('/', async (_req, res) => {
  const { rows: rehearsals } = await pool.query(
    'SELECT * FROM rehearsals ORDER BY proposed_date ASC, id ASC'
  )
  if (!rehearsals.length) return res.json([])
  const byRehearsal = await loadParticipants(rehearsals.map((r) => r.id))
  const result = rehearsals.map((r) => ({
    ...r,
    participants: byRehearsal.get(r.id) || [],
  }))
  res.json(result)
})

// Get single rehearsal
router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query('SELECT * FROM rehearsals WHERE id = $1', [id])
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  const byRehearsal = await loadParticipants([id])
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
         (proposed_date, start_time, end_time, location, notes, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        proposed_date,
        start_time || null,
        end_time || null,
        location || null,
        notes || null,
        req.user.id,
      ]
    )
    const rehearsal = insertRows[0]

    const { rows: leadRows } = await client.query(
      `SELECT id FROM band_members WHERE position = 'lead'`
    )
    const leadIds = leadRows.map((r) => r.id)

    let extraIds = []
    if (extras.length) {
      const { rows: validExtras } = await client.query(
        `SELECT id FROM band_members WHERE id = ANY($1)`,
        [extras]
      )
      extraIds = validExtras.map((r) => r.id)
    }

    const memberIds = Array.from(new Set([...leadIds, ...extraIds]))
    const creatorMemberId = await (async () => {
      const { rows } = await client.query(
        'SELECT id FROM band_members WHERE user_id = $1',
        [req.user.id]
      )
      return rows[0]?.id ?? null
    })()

    for (const mid of memberIds) {
      const vote = mid === creatorMemberId ? 'yes' : null
      const updatedBy = mid === creatorMemberId ? req.user.id : null
      await client.query(
        `INSERT INTO rehearsal_participants
           (rehearsal_id, band_member_id, vote, updated_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [rehearsal.id, mid, vote, updatedBy]
      )
    }

    await client.query('COMMIT')

    const byRehearsal = await loadParticipants([rehearsal.id])
    res.status(201).json({ ...rehearsal, participants: byRehearsal.get(rehearsal.id) || [] })
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
         FROM rehearsal_participants WHERE rehearsal_id = $1`,
        [id]
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
  values.push(id)

  const { rows } = await pool.query(
    `UPDATE rehearsals SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  const byRehearsal = await loadParticipants([id])
  res.json({ ...rows[0], participants: byRehearsal.get(id) || [] })
})

// Delete rehearsal
router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query('DELETE FROM rehearsals WHERE id = $1', [id])
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// Add participant
router.post('/:id/participants', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const memberId = parseId(req.body.band_member_id)
  if (memberId === null) return res.status(400).json({ error: 'Invalid band_member_id' })

  const { rows: memberRows } = await pool.query(
    'SELECT id FROM band_members WHERE id = $1',
    [memberId]
  )
  if (!memberRows.length) return res.status(404).json({ error: 'band_member not found' })

  const { rows: rehRows } = await pool.query('SELECT id FROM rehearsals WHERE id = $1', [id])
  if (!rehRows.length) return res.status(404).json({ error: 'Not found' })

  const creatorMemberId = await getBandMemberIdForUser(req.user.id)
  const vote = memberId === creatorMemberId ? 'yes' : null
  const updatedBy = memberId === creatorMemberId ? req.user.id : null

  try {
    await pool.query(
      `INSERT INTO rehearsal_participants
         (rehearsal_id, band_member_id, vote, updated_by_user_id)
       VALUES ($1, $2, $3, $4)`,
      [id, memberId, vote, updatedBy]
    )
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already a participant' })
    }
    throw err
  }

  await pool.query('UPDATE rehearsals SET updated_at = NOW() WHERE id = $1', [id])
  await autoDemoteIfNeeded(id)

  const { rows } = await pool.query('SELECT * FROM rehearsals WHERE id = $1', [id])
  const byRehearsal = await loadParticipants([id])
  res.status(201).json({ ...rows[0], participants: byRehearsal.get(id) || [] })
})

// Remove participant
router.delete('/:id/participants/:bandMemberId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const memberId = requireMemberId(req, res); if (memberId === null) return

  const { rowCount } = await pool.query(
    'DELETE FROM rehearsal_participants WHERE rehearsal_id = $1 AND band_member_id = $2',
    [id, memberId]
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })

  await pool.query('UPDATE rehearsals SET updated_at = NOW() WHERE id = $1', [id])
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
     WHERE rehearsal_id = $3 AND band_member_id = $4
     RETURNING *`,
    [vote, req.user.id, id, memberId]
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  await pool.query('UPDATE rehearsals SET updated_at = NOW() WHERE id = $1', [id])
  await autoDemoteIfNeeded(id)

  const { rows: rehRows } = await pool.query('SELECT * FROM rehearsals WHERE id = $1', [id])
  const byRehearsal = await loadParticipants([id])
  res.json({ ...rehRows[0], participants: byRehearsal.get(id) || [] })
})

export default router
