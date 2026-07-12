// Band-event domain logic. Route handlers stay thin and delegate here. Functions
// that can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload.
import { buildEventUpdateFields } from '../validators/bandEventValidators.js'
import {
  listBandEvents,
  fetchBandEvent,
  insertBandEvent,
  updateBandEventFields,
  deleteBandEvent as deleteBandEventRow,
} from '../repositories/bandEventRepository.js'
import { badRequest, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Not found')

export async function listEvents(db, tenantId) {
  return listBandEvents(db, tenantId)
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
