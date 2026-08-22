import { parsePositiveId as parseId } from '../../platform/http/requestValidators.js'

export { parseId }

export function normalizeGroupName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  return name || null
}

export function parseVenueIds(value) {
  if (!Array.isArray(value) || value.length === 0) return null
  const ids = value.map(parseId)
  if (ids.some((id) => id === null)) return null
  return [...new Set(ids)]
}
