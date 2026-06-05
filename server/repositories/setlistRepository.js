// SQL for setlists: list aggregates, the nested setlist→sets→items tree, and the
// transactional item reorder. Kept here so the route file stays thin.

// Map each item to the id of the item that immediately follows it in its set,
// from the current DB rows (id, set_id, sort_order). Items with no follower are
// absent from the map (treated as null follower by callers).
function buildOldFollowerMap(rows) {
  const bySet = new Map()
  for (const r of rows) {
    if (!bySet.has(r.set_id)) bySet.set(r.set_id, [])
    bySet.get(r.set_id).push(r)
  }
  const follower = new Map()
  for (const items of bySet.values()) {
    items.sort((a, b) => a.sort_order - b.sort_order)
    for (let i = 0; i < items.length - 1; i++) follower.set(items[i].id, items[i + 1].id)
  }
  return follower
}

// Same, but from the requested new order: [{ setId, itemIds: [...] }].
function buildNewFollowerMap(payloadSets) {
  const follower = new Map()
  for (const { itemIds } of payloadSets) {
    for (let i = 0; i < itemIds.length - 1; i++) follower.set(itemIds[i], itemIds[i + 1])
  }
  return follower
}

// List all setlists for a tenant with computed totals. The per-set
// include_in_total flag governs whether that set's time counts; song durations
// come from the songs table, pause/break durations from the item row. COALESCE
// guards against NULL totals for empty setlists.
export async function listSetlistsWithAggregates(db, tenantId) {
  const { rows } = await db.query(
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

// Fetch one setlist as a nested tree, or null if it doesn't belong to the tenant.
// Song items are enriched with title/artist/key/tempo/duration and their first tag.
export async function fetchSetlistTree(db, tenantId, setlistId) {
  const { rows: head } = await db.query(
    'SELECT id, name, created_at, updated_at FROM setlists WHERE id = $1 AND tenant_id = $2',
    [setlistId, tenantId],
  )
  if (!head.length) return null

  const { rows: sets } = await db.query(
    `SELECT id, name, include_in_total, sort_order
       FROM setlist_sets
      WHERE setlist_id = $1 AND tenant_id = $2
      ORDER BY sort_order ASC, id ASC`,
    [setlistId, tenantId],
  )

  const { rows: items } = await db.query(
    `SELECT
       i.id, i.set_id, i.item_type, i.song_id, i.label, i.sort_order,
       i.linked_to_next, i.transition_note,
       CASE WHEN i.item_type = 'song' THEN sg.duration_seconds ELSE i.duration_seconds END AS duration_seconds,
       sg.title, sg.artist, sg.song_key, sg.tempo,
       tag.name AS tag
     FROM setlist_items i
     JOIN setlist_sets st ON st.id = i.set_id AND st.tenant_id = i.tenant_id
     LEFT JOIN songs sg ON sg.id = i.song_id AND sg.tenant_id = i.tenant_id
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
    [setlistId, tenantId],
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

// Reorder (and move across sets) items in one transaction. `payloadSets` is
// [{ setId, itemIds: [...] }]. Validates that every set belongs to the setlist+
// tenant, that there are no duplicate item ids, and that the submitted ids are
// exactly the items currently in the affected sets — then rewrites set_id and
// sort_order. Returns { error } on validation failure.
export async function reorderItems(db, tenantId, setlistId, payloadSets) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const setIds = payloadSets.map((s) => s.setId)
    // Every target set must belong to this setlist + tenant.
    const { rows: validSets } = await client.query(
      `SELECT id FROM setlist_sets
        WHERE setlist_id = $1 AND tenant_id = $2 AND id = ANY($3)`,
      [setlistId, tenantId, setIds],
    )
    if (validSets.length !== new Set(setIds).size) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'Not found' } } }
    }

    const submittedIds = payloadSets.flatMap((s) => s.itemIds)
    if (new Set(submittedIds).size !== submittedIds.length) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'Duplicate item ids' } } }
    }

    // The submitted items must be exactly the items currently in those sets —
    // no item dropped, none injected from another set/setlist.
    const { rows: currentItems } = await client.query(
      `SELECT id, set_id, sort_order, item_type, linked_to_next
         FROM setlist_items WHERE tenant_id = $1 AND set_id = ANY($2)`,
      [tenantId, setIds],
    )
    const currentSet = new Set(currentItems.map((r) => r.id))
    if (currentSet.size !== submittedIds.length || submittedIds.some((id) => !currentSet.has(id))) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'Item set does not match current state' } } }
    }

    // Auto-clear broken segue links: a linked item whose immediate follower
    // changes identity (moved, replaced, or now last) loses its link + note.
    const oldFollower = buildOldFollowerMap(currentItems)
    const newFollower = buildNewFollowerMap(payloadSets)
    const clearedIds = currentItems
      .filter((it) => it.linked_to_next && (newFollower.get(it.id) ?? null) !== (oldFollower.get(it.id) ?? null))
      .map((it) => it.id)
    const cleared = new Set(clearedIds)

    for (const { setId, itemIds } of payloadSets) {
      for (let idx = 0; idx < itemIds.length; idx++) {
        const id = itemIds[idx]
        if (cleared.has(id)) {
          await client.query(
            `UPDATE setlist_items
                SET set_id = $1, sort_order = $2, linked_to_next = false, transition_note = NULL
              WHERE id = $3 AND tenant_id = $4`,
            [setId, idx, id, tenantId],
          )
        } else {
          await client.query(
            'UPDATE setlist_items SET set_id = $1, sort_order = $2 WHERE id = $3 AND tenant_id = $4',
            [setId, idx, id, tenantId],
          )
        }
      }
    }

    await client.query('COMMIT')
    return { ok: true, clearedIds }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
