// Setlist domain logic. Route handlers stay thin and delegate here. Functions
// that can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function). Multi-statement writes
// (create, reorder, delete-with-link-fixup) own their transaction here.
import pool from '../db/index.js'
import {
  trimOrNull,
  parseSearchLimit,
  buildSetUpdateFields,
  parseNewItem,
  buildItemPatch,
} from '../validators/setlistValidators.js'
import {
  listSetlistsWithAggregates,
  searchSetlists as searchSetlistRows,
  fetchSetlistTree,
  insertSetlist,
  updateSetlistName,
  deleteSetlist as deleteSetlistRow,
  insertSet,
  listSetIds,
  updateSetSortOrder,
  setSortAggregate,
  insertSetGuarded,
  updateSetFields,
  deleteSet as deleteSetRow,
  itemSortNext,
  insertSetlistItem,
  loadSongEnrichment,
  fetchItemInSetlist,
  updateSetlistItem,
  fetchItemForDelete,
  clearBrokenPredecessorLink,
  deleteSetlistItem,
  listValidSetIds,
  listItemsInSets,
  moveItem,
  moveItemClearingLink,
  upsertItemNote,
  deleteItemNote,
} from '../repositories/setlistRepository.js'
import { songExistsInTenant } from '../repositories/songRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

// Enrich a song item with its title/artist/key/tempo/duration + first tag so the
// client can render the 2-row card without a refetch. Non-song items pass through
// unchanged. A song row stores NULL duration_seconds, so this also restores the
// derived duration the client expects.
async function enrichSongItem(db, item, tenantId) {
  if (item.item_type !== 'song') return item
  const enrichment = await loadSongEnrichment(db, item.song_id, tenantId)
  return enrichment ? { ...item, ...enrichment } : item
}

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

// ---------- setlists ----------

export async function listSetlists(db, tenantId) {
  return listSetlistsWithAggregates(db, tenantId)
}

// Global-search read: matches setlists by name. Short queries (<3 chars) return
// nothing so we don't run a wildcard scan on every keystroke (mirrors searchGigs).
export async function searchSetlists(db, tenantId, query) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  return searchSetlistRows(db, tenantId, `%${q}%`, parseSearchLimit(query.limit))
}

export async function getSetlist(db, tenantId, setlistId, userId) {
  const tree = await fetchSetlistTree(db, tenantId, setlistId, userId)
  if (!tree) return NOT_FOUND
  return { tree }
}

// Every new setlist starts with one default set, created in the same transaction.
export async function createSetlist(tenantId, body) {
  const name = trimOrNull(body.name)
  if (!name) return badRequest('name is required')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const setlist = await insertSetlist(client, tenantId, name)
    await insertSet(client, setlist.id, tenantId, 'Set 1', 0)
    await client.query('COMMIT')
    return { setlist }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function patchSetlist(db, tenantId, setlistId, body) {
  const name = trimOrNull(body.name)
  if (!name) return badRequest('name is required')
  const setlist = await updateSetlistName(db, tenantId, setlistId, name)
  if (!setlist) return NOT_FOUND
  return { setlist }
}

export async function deleteSetlist(db, tenantId, setlistId) {
  const deleted = await deleteSetlistRow(db, setlistId, tenantId)
  return deleted ? {} : NOT_FOUND
}

// ---------- sets ----------

export async function reorderSets(tenantId, setlistId, orderedSetIds) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await listSetIds(client, setlistId, tenantId)
    const currentSet = new Set(current)
    const unique = new Set(orderedSetIds)
    if (unique.size !== orderedSetIds.length
      || currentSet.size !== orderedSetIds.length
      || orderedSetIds.some((sid) => !currentSet.has(sid))) {
      await client.query('ROLLBACK')
      return badRequest('Set ids do not match current state')
    }
    for (let idx = 0; idx < orderedSetIds.length; idx++) {
      await updateSetSortOrder(client, orderedSetIds[idx], idx, tenantId)
    }
    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function createSet(db, tenantId, setlistId, body) {
  const agg = await setSortAggregate(db, setlistId, tenantId)
  const name = trimOrNull(body.name) || `Set ${agg.count + 1}`
  const set = await insertSetGuarded(db, setlistId, tenantId, name, agg.next)
  if (!set) return NOT_FOUND
  return { set: { ...set, items: [] } }
}

export async function patchSet(db, tenantId, setlistId, setId, body) {
  const built = buildSetUpdateFields(body)
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const set = await updateSetFields(db, tenantId, setlistId, setId, built.fields, built.values)
  if (!set) return NOT_FOUND
  return { set }
}

export async function deleteSet(db, tenantId, setlistId, setId) {
  const deleted = await deleteSetRow(db, setId, setlistId, tenantId)
  return deleted ? {} : NOT_FOUND
}

// ---------- items ----------

export async function createItem(db, tenantId, setlistId, setId, body) {
  const parsed = parseNewItem(body)
  if (parsed.error) return badRequest(parsed.error)
  if (parsed.itemType === 'song' && !(await songExistsInTenant(db, parsed.songId, tenantId))) {
    return NOT_FOUND
  }

  const sortOrder = await itemSortNext(db, setId, tenantId)
  const row = await insertSetlistItem(db, {
    setId,
    setlistId,
    tenantId,
    itemType: parsed.itemType,
    songId: parsed.songId,
    durationSeconds: parsed.durationSeconds,
    label: parsed.label,
    sortOrder,
  })
  if (!row) return NOT_FOUND
  return { item: await enrichSongItem(db, row, tenantId) }
}

export async function patchItem(db, tenantId, setlistId, itemId, body) {
  const existing = await fetchItemInSetlist(db, itemId, tenantId, setlistId)
  if (!existing) return NOT_FOUND

  // Transitions only apply to songs; reject link fields on pause/break items.
  const touchesLink = 'linked_to_next' in body || 'transition_note' in body
  if (touchesLink && existing.item_type !== 'song') {
    return badRequest('Transitions are only valid on song items')
  }

  const patch = buildItemPatch(body, existing.item_type)
  if (patch.error) return badRequest(patch.error)
  const { sets, rawSets } = patch
  if (!sets.length && !rawSets.length) return badRequest('No valid fields to update')

  const values = sets.map((s) => s.value)
  const assignments = [...sets.map((s, i) => `${s.col} = $${i + 1}`), ...rawSets]
  const row = await updateSetlistItem(db, tenantId, itemId, assignments, values)
  return { item: await enrichSongItem(db, row, tenantId) }
}

// Reorder (and move across sets) items in one transaction. `payloadSets` is
// [{ setId, itemIds: [...] }]. Validates that every set belongs to the setlist+
// tenant, that there are no duplicate item ids, and that the submitted ids are
// exactly the items currently in the affected sets — then rewrites set_id and
// sort_order, auto-clearing broken segue links.
export async function reorderItems(tenantId, setlistId, payloadSets) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const setIds = payloadSets.map((s) => s.setId)
    const validSets = await listValidSetIds(client, setlistId, tenantId, setIds)
    if (validSets.length !== new Set(setIds).size) {
      await client.query('ROLLBACK')
      return NOT_FOUND
    }

    const submittedIds = payloadSets.flatMap((s) => s.itemIds)
    if (new Set(submittedIds).size !== submittedIds.length) {
      await client.query('ROLLBACK')
      return badRequest('Duplicate item ids')
    }

    const currentItems = await listItemsInSets(client, tenantId, setIds)
    const currentSet = new Set(currentItems.map((r) => r.id))
    if (currentSet.size !== submittedIds.length || submittedIds.some((id) => !currentSet.has(id))) {
      await client.query('ROLLBACK')
      return badRequest('Item set does not match current state')
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
          await moveItemClearingLink(client, setId, idx, id, tenantId)
        } else {
          await moveItem(client, setId, idx, id, tenantId)
        }
      }
    }

    await client.query('COMMIT')
    return { clearedIds }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Delete an item, clearing the (now broken) link on its immediate predecessor.
export async function deleteItem(tenantId, setlistId, itemId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Locate the item (scoped to this setlist + tenant) before deleting, so we can
    // find the immediate predecessor whose segue link points at it.
    const target = await fetchItemForDelete(client, itemId, tenantId, setlistId)
    if (!target) {
      await client.query('ROLLBACK')
      return NOT_FOUND
    }

    const clearedIds = await clearBrokenPredecessorLink(client, tenantId, target.set_id, target.sort_order)
    await deleteSetlistItem(client, itemId, tenantId)
    await client.query('COMMIT')
    return { clearedIds }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------- per-member notes ----------

// Upsert/clear the requesting user's personal note on a song item. The note is
// per (item, user); an empty/whitespace body removes it. Notes apply to songs only.
export async function setItemNote(db, tenantId, setlistId, userId, itemId, body) {
  const existing = await fetchItemInSetlist(db, itemId, tenantId, setlistId)
  if (!existing) return NOT_FOUND
  if (existing.item_type !== 'song') return badRequest('Notes are only valid on song items')

  const note = trimOrNull(body.note)
  if (note === null) {
    await deleteItemNote(db, itemId, userId, tenantId)
  } else {
    await upsertItemNote(db, itemId, tenantId, userId, note)
  }
  return { my_note: note }
}
