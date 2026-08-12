import { parseListLimit, parseTimestampCursor } from '../../platform/http/requestValidators.js'

export function parseUnclaimedProfileListQuery(query) {
  const limit = parseListLimit(query?.limit)
  if (limit === null) return { error: 'invalid_limit' }

  const parsedCursor = parseTimestampCursor(query)
  if (parsedCursor === null) return { error: 'invalid_cursor' }

  return { limit, cursor: parsedCursor.cursor }
}
