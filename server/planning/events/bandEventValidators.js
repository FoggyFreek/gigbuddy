// Input parsing and validation for band-event routes. No DB access here.
import { parsePositiveId as parseId, validateTimeValues } from '../../platform/http/requestValidators.js'
import { resolveEventEndDate, timeToMinutes } from '../../../shared/eventTimes.js'

// my_band_id is only meaningful in a personal workspace; the route gates the
// field on the MY_BANDS capability and the service validates it against my_bands.
export const EDITABLE_FIELDS = ['title', 'start_date', 'end_date', 'start_time', 'end_time', 'location', 'notes', 'my_band_id']

export { parseId }

export function normalizeEventTiming(body, current = {}) {
  const startDate = 'start_date' in body ? body.start_date : current.start_date
  const endDate = 'end_date' in body ? body.end_date : current.end_date
  const startTime = 'start_time' in body ? body.start_time : current.start_time
  const endTime = 'end_time' in body ? body.end_time : current.end_time

  const timeError = validateTimeValues(startTime, endTime)
  if (timeError) return { error: timeError }

  const effectiveEndDate = endDate || startDate
  const resolvedEndDate = resolveEventEndDate(startDate, effectiveEndDate, startTime, endTime)
  if (
    startTime && endTime
    && resolvedEndDate === startDate
    && timeToMinutes(startTime) === timeToMinutes(endTime)
  ) {
    return { error: 'end_time must be after start_time' }
  }

  return {
    body: resolvedEndDate !== effectiveEndDate
      ? { ...body, end_date: resolvedEndDate }
      : body,
  }
}

export function buildEventUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of EDITABLE_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }
  return { fields, values }
}
