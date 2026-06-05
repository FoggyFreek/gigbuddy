import { Router } from 'express'
import pool from '../db/index.js'
import {
  listSetlistsWithAggregates,
  fetchSetlistTree,
  reorderItems,
} from '../repositories/setlistRepository.js'

const router = Router()

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function requireParam(req, res, name) {
  const id = parseId(req.params[name])
  if (id === null) {
    res.status(400).json({ error: `Invalid ${name}` })
    return null
  }
  return id
}

function trimOrNull(val) {
  const s = String(val ?? '').trim()
  return s ? s : null
}

function toNonNegInt(val) {
  const n = Number(val)
  return Number.isInteger(n) && n >= 0 ? n : null
}

// Enrich a song item with its title/artist/key/tempo/duration + first tag so the
// client can render the 2-row card without a refetch. Non-song items pass through
// unchanged. A song row stores NULL duration_seconds, so this also restores the
// derived duration the client expects.
async function enrichSongItem(item, tenantId) {
  if (item.item_type !== 'song') return item
  const { rows } = await pool.query(
    `SELECT sg.title, sg.artist, sg.song_key, sg.tempo, sg.duration_seconds,
       (SELECT t.name FROM song_tag_links l
          JOIN song_tags t ON t.id = l.tag_id AND t.tenant_id = l.tenant_id
         WHERE l.song_id = sg.id AND l.tenant_id = sg.tenant_id
         ORDER BY t.name ASC LIMIT 1) AS tag
     FROM songs sg WHERE sg.id = $1 AND sg.tenant_id = $2`,
    [item.song_id, tenantId],
  )
  return rows.length ? { ...item, ...rows[0] } : item
}

// ---------- setlists ----------

router.get('/', async (req, res) => {
  const rows = await listSetlistsWithAggregates(pool, req.tenantId)
  res.json(rows)
})

router.post('/', async (req, res) => {
  const name = trimOrNull(req.body.name)
  if (!name) return res.status(400).json({ error: 'name is required' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      'INSERT INTO setlists (tenant_id, name) VALUES ($1, $2) RETURNING *',
      [req.tenantId, name],
    )
    const setlist = rows[0]
    // Every new setlist starts with one default set.
    await client.query(
      'INSERT INTO setlist_sets (setlist_id, tenant_id, name, sort_order) VALUES ($1, $2, $3, 0)',
      [setlist.id, req.tenantId, 'Set 1'],
    )
    await client.query('COMMIT')
    res.status(201).json(setlist)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const tree = await fetchSetlistTree(pool, req.tenantId, id, req.user.id)
  if (!tree) return res.status(404).json({ error: 'Not found' })
  res.json(tree)
})

router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const name = trimOrNull(req.body.name)
  if (!name) return res.status(400).json({ error: 'name is required' })
  const { rows } = await pool.query(
    'UPDATE setlists SET name = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *',
    [name, id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM setlists WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// ---------- sets ----------

// Reorder sets — registered before '/:id/sets/:setId' so 'reorder' isn't matched as an id.
router.patch('/:id/sets/reorder', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const orderedSetIds = req.body?.orderedSetIds
  if (!Array.isArray(orderedSetIds) || orderedSetIds.some((x) => parseId(x) === null)) {
    return res.status(400).json({ error: 'orderedSetIds must be an array of ids' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: current } = await client.query(
      'SELECT id FROM setlist_sets WHERE setlist_id = $1 AND tenant_id = $2',
      [id, req.tenantId],
    )
    const currentSet = new Set(current.map((r) => r.id))
    const unique = new Set(orderedSetIds)
    if (unique.size !== orderedSetIds.length
      || currentSet.size !== orderedSetIds.length
      || orderedSetIds.some((sid) => !currentSet.has(sid))) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Set ids do not match current state' })
    }
    for (let idx = 0; idx < orderedSetIds.length; idx++) {
      await client.query(
        'UPDATE setlist_sets SET sort_order = $1 WHERE id = $2 AND tenant_id = $3',
        [idx, orderedSetIds[idx], req.tenantId],
      )
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.post('/:id/sets', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const { rows: agg } = await pool.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next, COUNT(*)::int AS count
       FROM setlist_sets WHERE setlist_id = $1 AND tenant_id = $2`,
    [id, req.tenantId],
  )
  const name = trimOrNull(req.body.name) || `Set ${agg[0].count + 1}`
  const { rows } = await pool.query(
    `INSERT INTO setlist_sets (setlist_id, tenant_id, name, sort_order)
     SELECT sl.id, sl.tenant_id, $3, $4
     FROM setlists sl WHERE sl.id = $1 AND sl.tenant_id = $2
     RETURNING id, name, include_in_total, sort_order`,
    [id, req.tenantId, name, agg[0].next],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.status(201).json({ ...rows[0], items: [] })
})

router.patch('/:id/sets/:setId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const setId = requireParam(req, res, 'setId'); if (setId === null) return

  const fields = []
  const values = []
  let idx = 1
  if ('name' in req.body) {
    const name = trimOrNull(req.body.name)
    if (!name) return res.status(400).json({ error: 'name cannot be empty' })
    fields.push(`name = $${idx++}`); values.push(name)
  }
  if ('include_in_total' in req.body) {
    fields.push(`include_in_total = $${idx++}`); values.push(!!req.body.include_in_total)
  }
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  values.push(setId, id, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE setlist_sets SET ${fields.join(', ')}
       WHERE id = $${idx} AND setlist_id = $${idx + 1} AND tenant_id = $${idx + 2}
       RETURNING id, name, include_in_total, sort_order`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/:id/sets/:setId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const setId = requireParam(req, res, 'setId'); if (setId === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM setlist_sets WHERE id = $1 AND setlist_id = $2 AND tenant_id = $3',
    [setId, id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// ---------- items ----------

// Reorder/move items — registered before '/:id/items/:itemId'.
router.patch('/:id/items/reorder', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const sets = req.body?.sets
  if (!Array.isArray(sets)
    || sets.some((s) => parseId(s?.setId) === null || !Array.isArray(s?.itemIds)
      || s.itemIds.some((x) => parseId(x) === null))) {
    return res.status(400).json({ error: 'Invalid reorder payload' })
  }
  const payloadSets = sets.map((s) => ({ setId: Number(s.setId), itemIds: s.itemIds.map(Number) }))
  const result = await reorderItems(pool, req.tenantId, id, payloadSets)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json({ clearedIds: result.clearedIds })
})

router.post('/:id/sets/:setId/items', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const setId = requireParam(req, res, 'setId'); if (setId === null) return

  const itemType = req.body.item_type
  if (!['song', 'pause', 'break'].includes(itemType)) {
    return res.status(400).json({ error: 'Invalid item_type' })
  }

  let songId = null
  let durationSeconds = null
  if (itemType === 'song') {
    songId = parseId(req.body.song_id)
    if (songId === null) return res.status(400).json({ error: 'song_id is required for song items' })
    const { rows: songRows } = await pool.query(
      'SELECT 1 FROM songs WHERE id = $1 AND tenant_id = $2',
      [songId, req.tenantId],
    )
    if (!songRows.length) return res.status(404).json({ error: 'Not found' })
  } else {
    durationSeconds = toNonNegInt(req.body.duration_seconds)
    if (durationSeconds === null) {
      return res.status(400).json({ error: 'duration_seconds is required for pause/break items' })
    }
  }
  const label = trimOrNull(req.body.label)

  const { rows: agg } = await pool.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM setlist_items WHERE set_id = $1 AND tenant_id = $2`,
    [setId, req.tenantId],
  )

  // The SELECT guard ties the insert to a set that belongs to this setlist+tenant,
  // so a cross-tenant or wrong-setlist setId yields no row → 404.
  const { rows } = await pool.query(
    `INSERT INTO setlist_items (set_id, tenant_id, item_type, song_id, duration_seconds, label, sort_order)
     SELECT st.id, st.tenant_id, $4, $5, $6, $7, $8
     FROM setlist_sets st
     WHERE st.id = $1 AND st.setlist_id = $2 AND st.tenant_id = $3
     RETURNING id, set_id, item_type, song_id, duration_seconds, label, sort_order,
               linked_to_next, transition_note`,
    [setId, id, req.tenantId, itemType, songId, durationSeconds, label, agg[0].next],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  const item = await enrichSongItem(rows[0], req.tenantId)
  res.status(201).json(item)
})

router.patch('/:id/items/:itemId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const itemId = requireParam(req, res, 'itemId'); if (itemId === null) return

  // Load the item, scoped to a set within this setlist + tenant.
  const { rows: existing } = await pool.query(
    `SELECT i.id, i.item_type FROM setlist_items i
       JOIN setlist_sets st ON st.id = i.set_id AND st.tenant_id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2 AND st.setlist_id = $3`,
    [itemId, req.tenantId, id],
  )
  if (!existing.length) return res.status(404).json({ error: 'Not found' })

  // Transitions only apply to songs; reject link fields on pause/break items.
  const touchesLink = 'linked_to_next' in req.body || 'transition_note' in req.body
  if (touchesLink && existing[0].item_type !== 'song') {
    return res.status(400).json({ error: 'Transitions are only valid on song items' })
  }

  const fields = []
  const values = []
  let idx = 1
  if ('duration_seconds' in req.body) {
    if (existing[0].item_type === 'song') {
      return res.status(400).json({ error: 'Cannot set duration on a song item' })
    }
    const dur = toNonNegInt(req.body.duration_seconds)
    if (dur === null) return res.status(400).json({ error: 'Invalid duration_seconds' })
    fields.push(`duration_seconds = $${idx++}`); values.push(dur)
  }
  if ('label' in req.body) {
    fields.push(`label = $${idx++}`); values.push(trimOrNull(req.body.label))
  }
  // Unlinking always clears the note, even if the client omitted it, so a stale
  // note can't resurface on a later relink.
  let noteForcedNull = false
  if ('linked_to_next' in req.body) {
    const linked = Boolean(req.body.linked_to_next)
    fields.push(`linked_to_next = $${idx++}`); values.push(linked)
    if (!linked) { fields.push('transition_note = NULL'); noteForcedNull = true }
  }
  if ('transition_note' in req.body && !noteForcedNull) {
    fields.push(`transition_note = $${idx++}`); values.push(trimOrNull(req.body.transition_note))
  }
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  values.push(itemId, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE setlist_items SET ${fields.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1}
       RETURNING id, set_id, item_type, song_id, duration_seconds, label, sort_order,
                 linked_to_next, transition_note`,
    values,
  )
  res.json(await enrichSongItem(rows[0], req.tenantId))
})

// Upsert/clear the requesting user's personal note on a song item. The note is
// per (item, user); an empty/whitespace body removes it. Notes apply to songs
// only, mirroring the transition guard above.
router.put('/:id/items/:itemId/note', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const itemId = requireParam(req, res, 'itemId'); if (itemId === null) return

  // Scope the item to a set within this setlist + tenant; also read its type.
  const { rows: existing } = await pool.query(
    `SELECT i.id, i.item_type FROM setlist_items i
       JOIN setlist_sets st ON st.id = i.set_id AND st.tenant_id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2 AND st.setlist_id = $3`,
    [itemId, req.tenantId, id],
  )
  if (!existing.length) return res.status(404).json({ error: 'Not found' })
  if (existing[0].item_type !== 'song') {
    return res.status(400).json({ error: 'Notes are only valid on song items' })
  }

  const note = trimOrNull(req.body.note)
  if (note === null) {
    await pool.query(
      'DELETE FROM setlist_item_notes WHERE setlist_item_id = $1 AND user_id = $2 AND tenant_id = $3',
      [itemId, req.user.id, req.tenantId],
    )
  } else {
    await pool.query(
      `INSERT INTO setlist_item_notes (setlist_item_id, tenant_id, user_id, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (setlist_item_id, user_id)
       DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()`,
      [itemId, req.tenantId, req.user.id, note],
    )
  }
  res.json({ my_note: note })
})

router.delete('/:id/items/:itemId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const itemId = requireParam(req, res, 'itemId'); if (itemId === null) return

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Locate the item (scoped to this setlist + tenant) before deleting, so we can
    // find the immediate predecessor whose segue link points at it.
    const { rows: target } = await client.query(
      `SELECT i.set_id, i.sort_order FROM setlist_items i
         JOIN setlist_sets st ON st.id = i.set_id AND st.tenant_id = i.tenant_id
        WHERE i.id = $1 AND i.tenant_id = $2 AND st.setlist_id = $3`,
      [itemId, req.tenantId, id],
    )
    if (!target.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Not found' })
    }

    // The deleted item's follower-link source is its immediate predecessor in the
    // same set; if it was linked, that link is now broken → clear it + its note.
    const { rows: cleared } = await client.query(
      `UPDATE setlist_items SET linked_to_next = false, transition_note = NULL
        WHERE tenant_id = $1 AND linked_to_next = true AND id = (
          SELECT id FROM setlist_items
           WHERE set_id = $2 AND tenant_id = $1 AND sort_order < $3
           ORDER BY sort_order DESC LIMIT 1)
        RETURNING id`,
      [req.tenantId, target[0].set_id, target[0].sort_order],
    )

    await client.query('DELETE FROM setlist_items WHERE id = $1 AND tenant_id = $2', [itemId, req.tenantId])
    await client.query('COMMIT')
    res.json({ clearedIds: cleared.map((r) => r.id) })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export default router
