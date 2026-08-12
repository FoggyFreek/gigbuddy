import {
  MAX_LIST_LIMIT,
  parseListLimit,
  parseDateRange,
  rangeErrorMessage,
  encodeTimestampCursor,
} from '../../validators/common.js'
import { toDateStr } from '../../utils/dateOnly.js'
import { badRequest } from '../http/serviceErrors.js'

const limitError = (maxLimit) => badRequest(`limit must be an integer between 1 and ${maxLimit}`)
const rangeError = (maxDays) => badRequest(rangeErrorMessage(maxDays))

// Shared contract for endpoints that intentionally return only a bounded
// collection. The envelope can gain cursor/pagination metadata later without
// changing the top-level response shape.
export async function limitedCollection(rawLimit, fetchItems, maxLimit = MAX_LIST_LIMIT) {
  const limit = parseListLimit(rawLimit, maxLimit)
  if (limit === null) return limitError(maxLimit)

  const items = await fetchItems(limit)
  return {
    items,
    meta: {
      limit,
      returned: items.length,
    },
  }
}

// Variant for bounded feeds whose badges need the full matching row count.
// The repository returns both values from one statement (typically via
// COUNT(*) OVER ()), so the page and its total always describe one snapshot.
export async function limitedCollectionWithTotal(rawLimit, fetchPage, maxLimit = MAX_LIST_LIMIT) {
  const limit = parseListLimit(rawLimit, maxLimit)
  if (limit === null) return limitError(maxLimit)

  const { items, total } = await fetchPage(limit)
  return {
    items,
    meta: {
      limit,
      returned: items.length,
      total,
    },
  }
}

// Variant for deep bounded feeds ("load more"), which walk history with a
// keyset cursor instead of an offset. `dateOf` names the row's ordering date —
// the same column the repository's ORDER BY ... DESC, id DESC tiebreaks on, so
// the cursor and the query agree. A page short of its limit is the last page
// and gets no cursor.
export async function limitedCollectionWithCursor(rawLimit, fetchItems, dateOf, maxLimit = MAX_LIST_LIMIT) {
  const result = await limitedCollection(rawLimit, fetchItems, maxLimit)
  if (result.error) return result

  const last = result.items[result.items.length - 1]
  const nextCursor = last && result.items.length === result.meta.limit
    ? { date: toDateStr(dateOf(last)), id: last.id }
    : null

  return { items: result.items, meta: { ...result.meta, nextCursor } }
}

// The full-precision twin of limitedCollectionWithCursor, for feeds ordered by
// a TIMESTAMPTZ. `atOf` names the row's ordering instant — the same column the
// repository's ORDER BY ... DESC, id DESC tiebreaks on. The cursor is opaque
// (see parseTimestampCursor) because a visible date param would quietly drop
// the time and make rows sharing a day skip or repeat across pages.
export async function limitedCollectionWithTimestampCursor(rawLimit, fetchItems, atOf, maxLimit = MAX_LIST_LIMIT) {
  const result = await limitedCollection(rawLimit, fetchItems, maxLimit)
  if (result.error) return result

  const last = result.items[result.items.length - 1]
  const nextCursor = last && result.items.length === result.meta.limit
    ? encodeTimestampCursor(atOf(last), last.id)
    : null

  return { items: result.items, meta: { ...result.meta, nextCursor } }
}

// Timestamp-cursor variant for tables that also render MUI's known-total
// pagination controls. The repository returns the page and total from one
// statement, so both describe the same snapshot.
export async function limitedCollectionWithTimestampCursorAndTotal(
  rawLimit,
  fetchPage,
  atOf,
  maxLimit = MAX_LIST_LIMIT,
) {
  const result = await limitedCollectionWithTotal(rawLimit, fetchPage, maxLimit)
  if (result.error) return result

  const last = result.items[result.items.length - 1]
  const nextCursor = last && result.items.length === result.meta.limit
    ? encodeTimestampCursor(atOf(last), last.id)
    : null

  return { items: result.items, meta: { ...result.meta, nextCursor } }
}

// Shared contract for endpoints that return every item inside an inclusive
// day window (`?from=&to=`). Same envelope family as limitedCollection; meta
// echoes the window the server actually applied.
//
// `maxDays` caps the window WIDTH. Pass MAX_RANGE_DAYS on any feed whose
// fetcher fans out per row or per range (availability enrichment); leave it off
// for a single lean projection that is meant to span all history.
export async function windowedCollection(query, fetchItems, { maxDays = Infinity } = {}) {
  const range = parseDateRange(query, maxDays)
  if (range === null) return rangeError(maxDays)

  const items = await fetchItems(range)
  return {
    items,
    meta: {
      from: range.from,
      to: range.to,
      returned: items.length,
    },
  }
}
