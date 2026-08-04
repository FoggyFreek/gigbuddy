// Responsible for geographic coordinate range validation.
// Mirrors the venues_latitude_range / venues_longitude_range DB constraints.
export const LATITUDE_MIN = -90
export const LATITUDE_MAX = 90
export const LONGITUDE_MIN = -180
export const LONGITUDE_MAX = 180

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function inRange(value, min, max) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

// Lenient: null for blank, unparseable or out-of-range. For provider payloads
// where a bad coordinate should simply be dropped rather than rejected.
export function coordinateOrNull(value, min, max) {
  return isBlank(value) ? null : inRange(value, min, max)
}

// Strict tri-state for inputs that must 400 on malformed data:
// `{ value: number }` | `{ value: null }` when absent | `{ error: true }`.
export function parseCoordinate(value, min, max) {
  if (isBlank(value)) return { value: null }
  const parsed = inRange(value, min, max)
  return parsed === null ? { error: true } : { value: parsed }
}
