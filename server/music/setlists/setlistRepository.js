// Data-access helpers for setlists, their sets, items, and per-member notes.
// Each query takes an `executor` (a pool or transaction client) so callers
// control transactions. Every query is scoped by tenant_id.

// ---------- setlists ----------

// List all setlists for a tenant with computed totals. The per-set
// include_in_total flag governs whether that set's time counts; song durations
// come from the songs table, pause/break durations from the item row. COALESCE
// guards against NULL totals for empty setlists.
export async function listSetlistsWithAggregates(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT
       sl.id,
       sl.name,
       sl.created_at,
       sl.updated_at,
       COALESCE(SUM(
         CASE WHEN st.include_in_total THEN
           CASE WHEN i.item_type = 'song' THEN COALESCE(sg.duration_seconds, 0)
                ELSE COALESCE(i.duration_seconds, 0) END
         ELSE 0 END
       ), 0)::int AS total_seconds,
       COUNT(DISTINCT st.id)::int AS set_count,
       (COUNT(*) FILTER (WHERE i.item_type = 'song'))::int AS song_count
     FROM setlists sl
     LEFT JOIN setlist_sets st ON st.setlist_id = sl.id AND st.tenant_id = sl.tenant_id
     LEFT JOIN setlist_items i ON i.set_id = st.id AND i.tenant_id = sl.tenant_id
     LEFT JOIN songs sg ON sg.id = i.song_id AND sg.tenant_id = sl.tenant_id
     WHERE sl.tenant_id = $1
     GROUP BY sl.id
     ORDER BY sl.name ASC`,
    [tenantId],
  )
  return rows
}

// Global-search read: matches setlists on name. Exact name matches sort first,
// then alphabetically. Tenant-scoped like every other query.
export async function searchSetlists(executor, tenantId, like, limit) {
  const { rows } = await executor.query(
    `SELECT id, name
       FROM setlists
      WHERE tenant_id = $1 AND name ILIKE $2
      ORDER BY
        CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END,
        name ASC
      LIMIT $3`,
    [tenantId, like, limit],
  )
  return rows
}

// Fetch one setlist as a nested tree, or null if it doesn't belong to the tenant.
// Song items are enriched with title/artist/key/tempo/duration and their first tag,
// plus `my_note`: the requesting user's personal note on that song-in-set (or null).
export async function fetchSetlistTree(executor, tenantId, setlistId, userId) {
  const { rows: head } = await executor.query(
    'SELECT id, name, created_at, updated_at FROM setlists WHERE id = $1 AND tenant_id = $2',
    [setlistId, tenantId],
  )
  if (!head.length) return null

  const { rows: sets } = await executor.query(
    `SELECT id, name, include_in_total, sort_order
       FROM setlist_sets
      WHERE setlist_id = $1 AND tenant_id = $2
      ORDER BY sort_order ASC, id ASC`,
    [setlistId, tenantId],
  )

  const { rows: items } = await executor.query(
    `SELECT
       i.id, i.set_id, i.item_type, i.song_id, i.label, i.sort_order,
       i.linked_to_next, i.transition_note,
       CASE WHEN i.item_type = 'song' THEN sg.duration_seconds ELSE i.duration_seconds END AS duration_seconds,
       sg.title, sg.artist, sg.song_key, sg.tempo,
       tag.name AS tag,
       n.note AS my_note
     FROM setlist_items i
     JOIN setlist_sets st ON st.id = i.set_id AND st.tenant_id = i.tenant_id
     LEFT JOIN songs sg ON sg.id = i.song_id AND sg.tenant_id = i.tenant_id
     LEFT JOIN setlist_item_notes n
            ON n.setlist_item_id = i.id AND n.tenant_id = i.tenant_id AND n.user_id = $3
     LEFT JOIN LATERAL (
       SELECT t.name
         FROM song_tag_links l
         JOIN song_tags t ON t.id = l.tag_id AND t.tenant_id = l.tenant_id
        WHERE l.song_id = i.song_id AND l.tenant_id = i.tenant_id
        ORDER BY t.name ASC
        LIMIT 1
     ) tag ON true
     WHERE st.setlist_id = $1 AND i.tenant_id = $2
     ORDER BY i.set_id, i.sort_order ASC, i.id ASC`,
    [setlistId, tenantId, userId],
  )

  const itemsBySet = new Map()
  for (const it of items) {
    if (!itemsBySet.has(it.set_id)) itemsBySet.set(it.set_id, [])
    itemsBySet.get(it.set_id).push(it)
  }

  return {
    ...head[0],
    sets: sets.map((s) => ({ ...s, items: itemsBySet.get(s.id) || [] })),
  }
}

export async function insertSetlist(executor, tenantId, name) {
  const { rows } = await executor.query(
    'INSERT INTO setlists (tenant_id, name) VALUES ($1, $2) RETURNING *',
    [tenantId, name],
  )
  return rows[0]
}

export async function updateSetlistName(executor, tenantId, setlistId, name) {
  const { rows } = await executor.query(
    'UPDATE setlists SET name = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *',
    [name, setlistId, tenantId],
  )
  return rows[0] || null
}

export async function deleteSetlist(executor, setlistId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM setlists WHERE id = $1 AND tenant_id = $2',
    [setlistId, tenantId],
  )
  return rowCount > 0
}

// ---------- sets ----------

export async function insertSet(executor, setlistId, tenantId, name, sortOrder) {
  await executor.query(
    'INSERT INTO setlist_sets (setlist_id, tenant_id, name, sort_order) VALUES ($1, $2, $3, $4)',
    [setlistId, tenantId, name, sortOrder],
  )
}

export async function listSetIds(executor, setlistId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id FROM setlist_sets WHERE setlist_id = $1 AND tenant_id = $2',
    [setlistId, tenantId],
  )
  return rows.map((r) => r.id)
}

export async function updateSetSortOrder(executor, setId, sortOrder, tenantId) {
  await executor.query(
    'UPDATE setlist_sets SET sort_order = $1 WHERE id = $2 AND tenant_id = $3',
    [sortOrder, setId, tenantId],
  )
}

// Next sort_order and current set count for a setlist, used to position and name
// a freshly added set.
export async function setSortAggregate(executor, setlistId, tenantId) {
  const { rows } = await executor.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next, COUNT(*)::int AS count
       FROM setlist_sets WHERE setlist_id = $1 AND tenant_id = $2`,
    [setlistId, tenantId],
  )
  return rows[0]
}

// Inserts a set only when the parent setlist belongs to the tenant (SELECT
// guard). Returns the new set row, or null when the setlist doesn't exist.
export async function insertSetGuarded(executor, setlistId, tenantId, name, sortOrder) {
  const { rows } = await executor.query(
    `INSERT INTO setlist_sets (setlist_id, tenant_id, name, sort_order)
     SELECT sl.id, sl.tenant_id, $3, $4
     FROM setlists sl WHERE sl.id = $1 AND sl.tenant_id = $2
     RETURNING id, name, include_in_total, sort_order`,
    [setlistId, tenantId, name, sortOrder],
  )
  return rows[0] || null
}

// Applies prebuilt SET fragments to a set scoped to its setlist + tenant.
// Returns the updated row or null.
export async function updateSetFields(executor, tenantId, setlistId, setId, fields, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE setlist_sets SET ${fields.join(', ')}
       WHERE id = $${whereIdx} AND setlist_id = $${whereIdx + 1} AND tenant_id = $${whereIdx + 2}
       RETURNING id, name, include_in_total, sort_order`,
    [...values, setId, setlistId, tenantId],
  )
  return rows[0] || null
}

export async function deleteSet(executor, setId, setlistId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM setlist_sets WHERE id = $1 AND setlist_id = $2 AND tenant_id = $3',
    [setId, setlistId, tenantId],
  )
  return rowCount > 0
}

// ---------- items ----------

export async function itemSortNext(executor, setId, tenantId) {
  const { rows } = await executor.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM setlist_items WHERE set_id = $1 AND tenant_id = $2`,
    [setId, tenantId],
  )
  return rows[0].next
}

// Inserts an item only when its set belongs to this setlist + tenant (SELECT
// guard), so a cross-tenant or wrong-setlist setId yields no row → null.
export async function insertSetlistItem(executor, params) {
  const { setId, setlistId, tenantId, itemType, songId, durationSeconds, label, sortOrder } = params
  const { rows } = await executor.query(
    `INSERT INTO setlist_items (set_id, tenant_id, item_type, song_id, duration_seconds, label, sort_order)
     SELECT st.id, st.tenant_id, $4, $5, $6, $7, $8
     FROM setlist_sets st
     WHERE st.id = $1 AND st.setlist_id = $2 AND st.tenant_id = $3
     RETURNING id, set_id, item_type, song_id, duration_seconds, label, sort_order,
               linked_to_next, transition_note`,
    [setId, setlistId, tenantId, itemType, songId, durationSeconds, label, sortOrder],
  )
  return rows[0] || null
}

// Title/artist/key/tempo/duration + first tag for a song, used to enrich a song
// item response so the client can render the card without a refetch. Returns
// null when the song no longer belongs to the tenant.
export async function loadSongEnrichment(executor, songId, tenantId) {
  const { rows } = await executor.query(
    `SELECT sg.title, sg.artist, sg.song_key, sg.tempo, sg.duration_seconds,
       (SELECT t.name FROM song_tag_links l
          JOIN song_tags t ON t.id = l.tag_id AND t.tenant_id = l.tenant_id
         WHERE l.song_id = sg.id AND l.tenant_id = sg.tenant_id
         ORDER BY t.name ASC LIMIT 1) AS tag
     FROM songs sg WHERE sg.id = $1 AND sg.tenant_id = $2`,
    [songId, tenantId],
  )
  return rows[0] || null
}

// Loads an item's id + type, scoped to a set within this setlist + tenant.
export async function fetchItemInSetlist(executor, itemId, tenantId, setlistId) {
  const { rows } = await executor.query(
    `SELECT i.id, i.item_type FROM setlist_items i
       JOIN setlist_sets st ON st.id = i.set_id AND st.tenant_id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2 AND st.setlist_id = $3`,
    [itemId, tenantId, setlistId],
  )
  return rows[0] || null
}

// Applies prebuilt assignments (parameterized $1..$N plus literal rawSet
// fragments) to an item, appending the id + tenant WHERE bindings. The caller
// has already verified the item exists in this setlist + tenant.
export async function updateSetlistItem(executor, tenantId, itemId, assignments, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE setlist_items SET ${assignments.join(', ')}
       WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1}
       RETURNING id, set_id, item_type, song_id, duration_seconds, label, sort_order,
                 linked_to_next, transition_note`,
    [...values, itemId, tenantId],
  )
  return rows[0]
}

// Locates an item (scoped to this setlist + tenant) for deletion, returning its
// set_id + sort_order so the caller can find the predecessor whose link breaks.
export async function fetchItemForDelete(executor, itemId, tenantId, setlistId) {
  const { rows } = await executor.query(
    `SELECT i.set_id, i.sort_order FROM setlist_items i
       JOIN setlist_sets st ON st.id = i.set_id AND st.tenant_id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2 AND st.setlist_id = $3`,
    [itemId, tenantId, setlistId],
  )
  return rows[0] || null
}

// Clears the link (and note) on the immediate predecessor of a removed item, if
// that predecessor was linked. Returns the ids actually cleared.
export async function clearBrokenPredecessorLink(executor, tenantId, setId, sortOrder) {
  const { rows } = await executor.query(
    `UPDATE setlist_items SET linked_to_next = false, transition_note = NULL
      WHERE tenant_id = $1 AND linked_to_next = true AND id = (
        SELECT id FROM setlist_items
         WHERE set_id = $2 AND tenant_id = $1 AND sort_order < $3
         ORDER BY sort_order DESC LIMIT 1)
      RETURNING id`,
    [tenantId, setId, sortOrder],
  )
  return rows.map((r) => r.id)
}

export async function deleteSetlistItem(executor, itemId, tenantId) {
  await executor.query(
    'DELETE FROM setlist_items WHERE id = $1 AND tenant_id = $2',
    [itemId, tenantId],
  )
}

// ---------- item reorder (granular helpers; the service owns the transaction) ----------

export async function listValidSetIds(executor, setlistId, tenantId, setIds) {
  const { rows } = await executor.query(
    `SELECT id FROM setlist_sets
      WHERE setlist_id = $1 AND tenant_id = $2 AND id = ANY($3)`,
    [setlistId, tenantId, setIds],
  )
  return rows.map((r) => r.id)
}

export async function listItemsInSets(executor, tenantId, setIds) {
  const { rows } = await executor.query(
    `SELECT id, set_id, sort_order, item_type, linked_to_next
       FROM setlist_items WHERE tenant_id = $1 AND set_id = ANY($2)`,
    [tenantId, setIds],
  )
  return rows
}

export async function moveItem(executor, setId, sortOrder, itemId, tenantId) {
  await executor.query(
    'UPDATE setlist_items SET set_id = $1, sort_order = $2 WHERE id = $3 AND tenant_id = $4',
    [setId, sortOrder, itemId, tenantId],
  )
}

export async function moveItemClearingLink(executor, setId, sortOrder, itemId, tenantId) {
  await executor.query(
    `UPDATE setlist_items
        SET set_id = $1, sort_order = $2, linked_to_next = false, transition_note = NULL
      WHERE id = $3 AND tenant_id = $4`,
    [setId, sortOrder, itemId, tenantId],
  )
}

// ---------- per-member notes ----------

export async function upsertItemNote(executor, itemId, tenantId, userId, note) {
  await executor.query(
    `INSERT INTO setlist_item_notes (setlist_item_id, tenant_id, user_id, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (setlist_item_id, user_id)
     DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()`,
    [itemId, tenantId, userId, note],
  )
}

export async function deleteItemNote(executor, itemId, userId, tenantId) {
  await executor.query(
    'DELETE FROM setlist_item_notes WHERE setlist_item_id = $1 AND user_id = $2 AND tenant_id = $3',
    [itemId, userId, tenantId],
  )
}
