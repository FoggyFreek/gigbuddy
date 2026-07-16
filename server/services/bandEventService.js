// Band-event domain logic. Route handlers stay thin and delegate here. Functions
// that can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload.
import { buildEventUpdateFields } from '../validators/bandEventValidators.js'
import {
  listBandEvents,
  listUpcomingBandEvents as listUpcomingBandEventRows,
  listPastBandEvents as listPastBandEventRows,
  listBandEventsInRange as listBandEventsInRangeRows,
  fetchBandEvent,
  insertBandEvent,
  updateBandEventFields,
  deleteBandEvent as deleteBandEventRow,
} from '../repositories/bandEventRepository.js'
import { parseListCursor, parseLocalDate } from '../validators/common.js'
import { badRequest, notFound } from './serviceErrors.js'
import { limitedCollection, windowedCollection } from './limitedCollectionService.js'

const NOT_FOUND = notFound('Not found')
const INVALID_TODAY = 'today must be a valid ISO date (YYYY-MM-DD)'
const INVALID_CURSOR = 'cursorDate and cursorId must be provided together and valid'

function dateStr(value) {
  return value?.toISOString?.().slice(0, 10) ?? String(value).slice(0, 10)
}

export async function listEvents(db, tenantId) {
  return listBandEvents(db, tenantId)
}

export async function listUpcomingEvents(db, tenantId, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  return limitedCollection(query.limit, (limit) => listUpcomingBandEventRows(db, tenantId, today, limit))
}

export async function listPastEvents(db, tenantId, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)

  const result = await limitedCollection(query.limit, (limit) =>
    listPastBandEventRows(db, tenantId, today, limit, parsedCursor.cursor))
  if (result.error) return result

  const last = result.items[result.items.length - 1]
  const nextCursor = last && result.items.length === result.meta.limit
    ? { date: dateStr(last.end_date), id: last.id }
    : null
  return { items: result.items, meta: { ...result.meta, nextCursor } }
}

export async function listEventsInRange(db, tenantId, query = {}) {
  return windowedCollection(query, (range) => listBandEventsInRangeRows(db, tenantId, range.from, range.to))
}

export async function getEvent(db, tenantId, eventId) {
  const event = await fetchBandEvent(db, eventId, tenantId)
  if (!event) return NOT_FOUND
  return { event }
}

export async function createEvent(db, tenantId, body) {
  const { title, start_date, end_date, start_time, end_time, location, notes } = body
  if (!title || !start_date) return badRequest('title and start_date are required')

  const event = await insertBandEvent(db, tenantId, {
    title,
    start_date,
    end_date: end_date || start_date,
    start_time: start_time || null,
    end_time: end_time || null,
    location: location || null,
    notes: notes || null,
  })
  return { event }
}

export async function patchEvent(db, tenantId, eventId, body) {
  const built = buildEventUpdateFields(body)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const event = await updateBandEventFields(db, tenantId, eventId, built.fields, built.values)
  if (!event) return NOT_FOUND
  return { event }
}

export async function deleteEvent(db, tenantId, eventId) {
  const deleted = await deleteBandEventRow(db, eventId, tenantId)
  return deleted ? {} : NOT_FOUND
}
