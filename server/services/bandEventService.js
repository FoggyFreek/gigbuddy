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
  loadBandEventParticipantIds,
  insertBandEvent,
  insertBandEventParticipant,
  deleteBandEventParticipant,
  updateBandEventFields,
  deleteBandEvent as deleteBandEventRow,
} from '../repositories/bandEventRepository.js'
import { INVALID_CURSOR, INVALID_TODAY, parseListCursor, parseLocalDate, validateDailyTimeRange } from '../validators/common.js'
import { badRequest, notFound } from './serviceErrors.js'
import { assertMyBandWritable } from './myBandService.js'
import {
  limitedCollection,
  limitedCollectionWithCursor,
  windowedCollection,
} from './limitedCollectionService.js'
import { loadAvailabilityMatrix } from './availabilityService.js'
import { summarizeSpan } from '../domain/availabilitySpan.js'
import { toDateStr } from '../utils/dateOnly.js'
import { TENANT_CAPABILITIES, tenantKindSupports } from '../../shared/tenantCapabilities.js'
import { listBandMembers, bandMemberExistsInTenant } from '../repositories/bandMemberRepository.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'

const NOT_FOUND = notFound('Not found')

// ---------- availability ----------

// A band event runs over a span, so a member is summarised by their WORST day
// in it (see server/domain/availabilitySpan.js). The whole batch shares ONE
// matrix query covering min(start) .. max(end); the per-event slicing is JS.
//
// Personal workspaces have no band availability at all, so they get the rows
// untouched rather than an empty column.
export async function enrichEventsWithAvailability(db, tenantId, scope, events) {
  const { tenantKind, viewer = null, withDays = false } = scope
  if (!events.length) return events
  if (!tenantKindSupports(tenantKind, TENANT_CAPABILITIES.BAND_AVAILABILITY)) return events

  const starts = events.map((e) => toDateStr(e.start_date)).filter(Boolean)
  if (!starts.length) return events
  const ends = events.map((e) => toDateStr(e.end_date) ?? toDateStr(e.start_date)).filter(Boolean)
  const from = starts.reduce((a, b) => (a < b ? a : b))
  const to = ends.reduce((a, b) => (a > b ? a : b))

  const [matrix, participantsByEvent] = await Promise.all([
    loadAvailabilityMatrix(db, tenantId, from, to, viewer),
    loadBandEventParticipantIds(db, events.map((event) => event.id), tenantId),
  ])

  return events.map((event) => {
    const start = toDateStr(event.start_date)
    const { members, days } = summarizeSpan(matrix, start, toDateStr(event.end_date) ?? start, {
      start_date: start,
      end_date: toDateStr(event.end_date) ?? start,
      start_time: event.start_time,
      end_time: event.end_time,
      exclude: { type: 'band_event', id: event.id },
    })
    const participants = participantsByEvent.get(event.id) ?? []
    const selected = new Set(participants.map((participant) => participant.band_member_id))
    const selectedMembers = members.filter((member) => selected.has(member.member_id))
    const evaluatedIds = new Set(selectedMembers.map((member) => member.member_id))
    const formerMembers = participants
      .filter((participant) => participant.deleted_at && !evaluatedIds.has(participant.band_member_id))
      .map((participant) => ({
        member_id: participant.band_member_id,
        name: participant.name,
        color: participant.color,
        position: participant.position,
        source: 'former',
      }))
    return {
      ...event,
      members_availability: [...selectedMembers, ...formerMembers],
      // The per-day breakdown is detail-only — list feeds stay lean.
      ...(withDays ? {
        availability_days: days.map((day) => ({
          ...day,
          members: day.members.filter((member) => selected.has(member.member_id)),
        })),
      } : {}),
    }
  })
}

export async function listEvents(db, tenantId, scope = {}) {
  return enrichEventsWithAvailability(db, tenantId, scope, await listBandEvents(db, tenantId))
}

export async function listUpcomingEvents(db, tenantId, query = {}, scope = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const result = await limitedCollection(query.limit, (limit) => listUpcomingBandEventRows(db, tenantId, today, limit))
  if (result.error) return result
  return { ...result, items: await enrichEventsWithAvailability(db, tenantId, scope, result.items) }
}

export async function listPastEvents(db, tenantId, query = {}, scope = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)

  const result = await limitedCollectionWithCursor(query.limit, (limit) =>
    listPastBandEventRows(db, tenantId, today, limit, parsedCursor.cursor), (event) => event.end_date)
  if (result.error) return result

  return { ...result, items: await enrichEventsWithAvailability(db, tenantId, scope, result.items) }
}

// Deliberately NOT enriched: this feed drives the calendar grid, which renders
// the availability slots itself from /api/availability.
export async function listEventsInRange(db, tenantId, query = {}) {
  return windowedCollection(query, (range) => listBandEventsInRangeRows(db, tenantId, range.from, range.to))
}

export async function getEvent(db, tenantId, eventId, scope = {}) {
  const event = await fetchBandEvent(db, eventId, tenantId)
  if (!event) return NOT_FOUND
  const [enriched] = await enrichEventsWithAvailability(db, tenantId, { ...scope, withDays: true }, [event])
  return { event: enriched }
}

export async function createEvent(db, tenantId, body) {
  const { title, start_date, end_date, start_time, end_time, location, notes } = body
  if (!title || !start_date) return badRequest('title and start_date are required')
  const timeError = validateDailyTimeRange(start_time, end_time)
  if (timeError) return badRequest(timeError)

  return withTransaction(async (client) => {
    // Holds the My Bands row for the rest of this transaction, so a concurrent
    // removal cannot turn this insert into a foreign-key violation.
    const bandCheck = await assertMyBandWritable(client, tenantId, body.my_band_id)
    if (bandCheck) abortTransaction(bandCheck)

    const event = await insertBandEvent(client, tenantId, {
      title,
      start_date,
      end_date: end_date || start_date,
      start_time: start_time || null,
      end_time: end_time || null,
      location: location || null,
      notes: notes || null,
      my_band_id: body.my_band_id ?? null,
    })
    const members = await listBandMembers(client, tenantId)
    for (const member of members.filter((candidate) => candidate.position === 'lead')) {
      await insertBandEventParticipant(client, tenantId, event.id, member.id)
    }
    return { event }
  }, { db })
}

export async function addParticipant(db, tenantId, eventId, memberId, scope = {}) {
  if (!(await fetchBandEvent(db, eventId, tenantId))) return NOT_FOUND
  if (!(await bandMemberExistsInTenant(db, memberId, tenantId))) return NOT_FOUND

  try {
    await insertBandEventParticipant(db, tenantId, eventId, memberId)
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'Already a participant' } } }
    }
    throw err
  }

  return getEvent(db, tenantId, eventId, scope)
}

export async function removeParticipant(db, tenantId, eventId, memberId) {
  const removed = await deleteBandEventParticipant(db, tenantId, eventId, memberId)
  return removed ? {} : NOT_FOUND
}

export async function patchEvent(db, tenantId, eventId, body) {
  if ('start_time' in body || 'end_time' in body) {
    const current = await fetchBandEvent(db, eventId, tenantId)
    if (!current) return NOT_FOUND
    const timeError = validateDailyTimeRange(
      'start_time' in body ? body.start_time : current.start_time,
      'end_time' in body ? body.end_time : current.end_time,
    )
    if (timeError) return badRequest(timeError)
  }
  const built = buildEventUpdateFields(body)
  if (!built.fields.length) return badRequest('No valid fields to update')

  // In a transaction so the My Bands row stays locked from validation through
  // the write; the check is a no-op when the body doesn't mention the link.
  return withTransaction(async (client) => {
    const bandCheck = await assertMyBandWritable(client, tenantId, body.my_band_id)
    if (bandCheck) abortTransaction(bandCheck)

    const event = await updateBandEventFields(client, tenantId, eventId, built.fields, built.values)
    if (!event) abortTransaction(NOT_FOUND)
    return { event }
  }, { db })
}

export async function deleteEvent(db, tenantId, eventId) {
  const deleted = await deleteBandEventRow(db, eventId, tenantId)
  return deleted ? {} : NOT_FOUND
}
