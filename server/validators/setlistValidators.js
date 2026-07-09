// Input parsing and validation for setlist routes. No DB access here.
import {
  parsePositiveId as parseId,
  parseSearchLimit,
  trimOrNull,
} from './common.js'

export { parseId, parseSearchLimit, trimOrNull }

export function toNonNegInt(val) {
  const n = Number(val)
  return Number.isInteger(n) && n >= 0 ? n : null
}

// Builds SET fragments ($1..$N) for a set PATCH. Returns { error } on invalid input.
export function buildSetUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  if ('name' in body) {
    const name = trimOrNull(body.name)
    if (!name) return { error: 'name cannot be empty' }
    fields.push(`name = $${idx++}`); values.push(name)
  }
  if ('include_in_total' in body) {
    fields.push(`include_in_total = $${idx++}`); values.push(!!body.include_in_total)
  }
  return { fields, values }
}

// Parses a new setlist-item body. Returns { error } when the shape is invalid,
// otherwise { itemType, songId, durationSeconds, label }. Song existence is
// verified later by the service (it needs the DB).
export function parseNewItem(body) {
  const itemType = body.item_type
  if (!['song', 'pause', 'break'].includes(itemType)) {
    return { error: 'Invalid item_type' }
  }
  const label = trimOrNull(body.label)
  if (itemType === 'song') {
    const songId = parseId(body.song_id)
    if (songId === null) return { error: 'song_id is required for song items' }
    return { itemType, songId, durationSeconds: null, label }
  }
  const durationSeconds = toNonNegInt(body.duration_seconds)
  if (durationSeconds === null) {
    return { error: 'duration_seconds is required for pause/break items' }
  }
  return { itemType, songId: null, durationSeconds, label }
}

// Collect the SET clause for a setlist-item PATCH. Returns { error } on an invalid
// field, otherwise { sets, rawSets }: `sets` are parameterized { col, value } pairs
// and `rawSets` are literal assignments (e.g. clearing a note when unlinking).
export function buildItemPatch(body, itemType) {
  const sets = []
  const rawSets = []
  if ('duration_seconds' in body) {
    if (itemType === 'song') return { error: 'Cannot set duration on a song item' }
    const dur = toNonNegInt(body.duration_seconds)
    if (dur === null) return { error: 'Invalid duration_seconds' }
    sets.push({ col: 'duration_seconds', value: dur })
  }
  if ('label' in body) {
    sets.push({ col: 'label', value: trimOrNull(body.label) })
  }
  // Unlinking always clears the note, even if the client omitted it, so a stale
  // note can't resurface on a later relink.
  let noteForcedNull = false
  if ('linked_to_next' in body) {
    const linked = Boolean(body.linked_to_next)
    sets.push({ col: 'linked_to_next', value: linked })
    if (!linked) { rawSets.push('transition_note = NULL'); noteForcedNull = true }
  }
  if ('transition_note' in body && !noteForcedNull) {
    sets.push({ col: 'transition_note', value: trimOrNull(body.transition_note) })
  }
  return { sets, rawSets }
}

// Validates the body of PATCH /:id/sets/reorder. Returns { error } or { orderedSetIds }.
export function parseOrderedSetIds(body) {
  const orderedSetIds = body?.orderedSetIds
  if (!Array.isArray(orderedSetIds) || orderedSetIds.some((x) => parseId(x) === null)) {
    return { error: 'orderedSetIds must be an array of ids' }
  }
  return { orderedSetIds }
}

// Validates the body of PATCH /:id/items/reorder. Returns { error } or
// { payloadSets } as [{ setId, itemIds: [...] }] with numeric ids.
export function parseReorderItemsPayload(body) {
  const sets = body?.sets
  if (!Array.isArray(sets)
    || sets.some((s) => parseId(s?.setId) === null || !Array.isArray(s?.itemIds)
      || s.itemIds.some((x) => parseId(x) === null))) {
    return { error: 'Invalid reorder payload' }
  }
  return { payloadSets: sets.map((s) => ({ setId: Number(s.setId), itemIds: s.itemIds.map(Number) })) }
}
