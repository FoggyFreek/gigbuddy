import { MAX_LIST_LIMIT, parseListLimit, parseDateRange } from '../validators/common.js'
import { badRequest } from './serviceErrors.js'

const limitError = (maxLimit) => badRequest(`limit must be an integer between 1 and ${maxLimit}`)
const rangeError = () => badRequest('from and to must be valid ISO dates (YYYY-MM-DD) with from <= to')

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

// Shared contract for endpoints that return every item inside an inclusive
// day window (`?from=&to=`). Same envelope family as limitedCollection; meta
// echoes the window the server actually applied.
export async function windowedCollection(query, fetchItems) {
  const range = parseDateRange(query)
  if (range === null) return rangeError()

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
