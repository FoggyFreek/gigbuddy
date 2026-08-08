// The cross-tenant artist agenda: everything the musician is booked for across
// every approved band membership plus their own workspace.
//
// This is the one place that deliberately departs from "every read is scoped by
// req.tenantId", so the rules are spelled out rather than implied:
//
//   - The tenant scope arrives on `req.memberTenants` from resolveMemberTenantIds
//     and is derived from approved, non-archived memberships. Nothing here
//     reads a tenant id from the request — a tenant id in a body or query
//     changes nothing.
//   - A tenant the caller can't see is ABSENT from the response, never present
//     and blanked — the same "404, not 403" instinct applied to a payload.
import {
  limitedCollection,
  limitedCollectionWithCursor,
  limitedCollectionWithTotal,
  windowedCollection,
} from './limitedCollectionService.js'
import { badRequest, notFound } from './serviceErrors.js'
import { toDateStr } from '../utils/dateOnly.js'
import {
  INVALID_CURSOR,
  INVALID_TODAY,
  parseListCursor,
  parseLocalDate,
  parseSearchLimit,
} from '../validators/common.js'
import { MAX_TASK_LIST_LIMIT, parseTaskDoneFilter } from '../validators/taskValidators.js'
import {
  listGigsInRangeForMemberTenants,
  listGigMapDataForMemberTenants,
  listPastGigsForMemberTenants,
  searchGigsForMemberTenants,
  listUpcomingGigsForMemberTenants,
  findGigTenantForMember,
} from '../repositories/gigRepository.js'
import { getBandMemberIdForUser } from '../repositories/bandMemberRepository.js'
import {
  findRehearsalTenantForMember,
  listNextPlannedRehearsalForMemberTenants,
  listPastRehearsalsForMemberTenants,
  listRehearsalsInRangeForMemberTenants,
  listUpcomingRehearsalsForMemberTenants,
  loadParticipants as loadRehearsalParticipants,
} from '../repositories/rehearsalRepository.js'
import {
  findBandEventTenantForMember,
  listBandEventsInRangeForMemberTenants,
  listPastBandEventsForMemberTenants,
  listUpcomingBandEventsForMemberTenants,
} from '../repositories/bandEventRepository.js'
import {
  findAssignedTaskTenantForMember,
  listTasksAssignedToUserForMemberTenants,
} from '../repositories/taskRepository.js'
import { enrichGigsWithAvailability, getGig } from './gigService.js'
import {
  getRehearsal,
  setParticipantVote,
} from './rehearsalService.js'
import { enrichEventsWithAvailability, getEvent } from './bandEventService.js'
import { patchTask } from './taskService.js'

const NOT_FOUND = notFound('Not found')

// `/api/files/:key` is gated on the *active* tenant, so a banner belonging to
// another band could never be fetched. Drop it rather than emit a path that is
// guaranteed to 404.
const withoutBanner = ({ banner_path: _bannerPath, ...gig }) => gig

// Every enrichment down here (participants, availability) is a tenant-scoped
// query, but the feed interleaves bands. Group the rows, enrich each band
// concurrently, then restore the feed's order — `enrich` may return its rows in
// any order as long as it returns one per row it was given.
async function perTenant(rows, enrich) {
  const groups = new Map()
  for (const row of rows) {
    const group = groups.get(row.tenant_id) ?? []
    group.push(row)
    groups.set(row.tenant_id, group)
  }

  const enriched = new Map()
  await Promise.all([...groups].map(async ([tenantId, group]) => {
    for (const row of await enrich(tenantId, group)) enriched.set(row.id, row)
  }))
  return rows.map((row) => enriched.get(row.id))
}

const attachRehearsalParticipants = (db, userId, rows) =>
  perTenant(rows, async (tenantId, rehearsals) => {
    const [byId, viewerBandMemberId] = await Promise.all([
      loadRehearsalParticipants(db, rehearsals.map((r) => r.id), tenantId),
      getBandMemberIdForUser(db, userId, tenantId),
    ])
    return rehearsals.map((r) => ({ ...r, participants: byId.get(r.id) ?? [], viewerBandMemberId }))
  })

const attachGigAvailability = (db, userId, rows) =>
  perTenant(rows, (tenantId, gigs) =>
    enrichGigsWithAvailability(db, tenantId, gigs, { userId, tenantId }))

const attachBandEventAvailability = (db, userId, scope, rows, withDays = false) =>
  perTenant(rows, (tenantId, events) => enrichEventsWithAvailability(db, tenantId, {
    tenantKind: scope.byId.get(tenantId)?.kind,
    viewer: { userId, tenantId },
    withDays,
  }, events))

// One agenda row, whatever the underlying entity. `type` + `id` identify the
// source so the frontend can build the right in-tenant link.
function agendaItem(type, row, date, title, scope, endDate = date) {
  const tenant = scope.ref(row.tenant_id)
  return {
    type,
    id: row.id,
    date: toDateStr(date),
    endDate: toDateStr(endDate),
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    title: title ?? null,
    description: [title, tenant.tenantName].filter(Boolean).join(' — ') || null,
    location: row.location ?? row.venue?.name ?? row.festival?.name ?? null,
    status: row.status ?? null,
    // Explicit, because this object is built field by field: anything the
    // projections add is dropped here unless it is named.
    myBand: row.my_band ?? null,
    ...tenant,
  }
}

export async function listMyAgenda(db, userId, scope, query = {}) {
  return windowedCollection(query, async (range) => {
    const [gigs, rehearsals, bandEvents] = await Promise.all([
      listGigsInRangeForMemberTenants(db, userId, scope.ids, range.from, range.to),
      listRehearsalsInRangeForMemberTenants(db, userId, scope.ids, range.from, range.to),
      listBandEventsInRangeForMemberTenants(db, userId, scope.ids, range.from, range.to),
    ])

    const items = [
      ...gigs.map((g) => agendaItem('gig', g, g.event_date, g.event_description, scope)),
      ...rehearsals.map((r) => agendaItem('rehearsal', r, r.proposed_date, r.location, scope)),
      ...bandEvents.map((e) => agendaItem('band_event', e, e.start_date, e.title, scope, e.end_date)),
    ]
    // One chronological feed across every band. The (type, id) tiebreak keeps
    // the order stable when two items share a date.
    items.sort((a, b) =>
      a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.id - b.id)
    return items
  })
}

// ---- artist dashboard feeds ----
//
// Each mirrors the envelope of its tenant-scoped sibling so the dashboard can
// swap one call for the other and keep its view model. None of them enriches
// rows with availability: that redaction is relative to a *viewing band*, and
// here there is no active tenant — these rows are already only the caller's own
// bookings.

export async function listMyUpcomingGigs(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)

  const result = await limitedCollectionWithTotal(query.limit, (limit) =>
    listUpcomingGigsForMemberTenants(db, userId, scope.ids, today, limit))
  if (result.error) return result
  const items = await attachGigAvailability(db, userId, result.items)
  return { ...result, items: items.map((gig) => scope.label(withoutBanner(gig))) }
}

export async function listMyPastGigs(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)

  const result = await limitedCollectionWithCursor(query.limit, (limit) =>
    listPastGigsForMemberTenants(db, userId, scope.ids, today, limit, parsedCursor.cursor),
  (gig) => gig.event_date)
  if (result.error) return result
  const items = await attachGigAvailability(db, userId, result.items)
  return { ...result, items: items.map((gig) => scope.label(withoutBanner(gig))) }
}

export async function searchMyGigs(db, userId, scope, query = {}) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  const rows = await searchGigsForMemberTenants(db, userId, scope.ids, {
    like: `%${q}%`, limit: parseSearchLimit(query.limit),
  })
  return rows.map((gig) => scope.label(withoutBanner(gig)))
}

export async function getMyGig(db, userId, scope, gigId) {
  const tenantId = await findGigTenantForMember(db, userId, scope.ids, gigId)
  if (tenantId == null) return NOT_FOUND
  const result = await getGig(db, tenantId, gigId)
  if (result.error) return NOT_FOUND
  if (scope.byId.get(tenantId)?.kind === 'personal') {
    return { gig: scope.label(result.gig) }
  }
  const memberId = await getBandMemberIdForUser(db, userId, tenantId)
  const attachments = (result.gig.attachments ?? []).map(({ object_key: _objectKey, ...attachment }) => attachment)
  const tasks = (result.gig.tasks ?? []).filter((task) => task.assigned_to === memberId)
  const { participants: _participants, ...withoutParticipants } = result.gig
  return {
    gig: scope.label({
      ...withoutBanner(withoutParticipants), attachments, tasks, viewerBandMemberId: memberId,
    }),
  }
}

export async function getMyNextRehearsal(db, userId, scope) {
  const rehearsal = await listNextPlannedRehearsalForMemberTenants(db, userId, scope.ids)
  return { rehearsal: rehearsal ? scope.label(rehearsal) : null }
}

export async function listMyUpcomingRehearsals(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const result = await limitedCollection(query.limit, (limit) =>
    listUpcomingRehearsalsForMemberTenants(db, userId, scope.ids, today, limit))
  if (result.error) return result
  return { ...result, items: (await attachRehearsalParticipants(db, userId, result.items)).map(scope.label) }
}

export async function listMyPastRehearsals(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)
  const result = await limitedCollectionWithCursor(query.limit, (limit) =>
    listPastRehearsalsForMemberTenants(db, userId, scope.ids, today, limit, parsedCursor.cursor),
  (r) => r.proposed_date)
  if (result.error) return result
  return { ...result, items: (await attachRehearsalParticipants(db, userId, result.items)).map(scope.label) }
}

export async function getMyRehearsal(db, userId, scope, rehearsalId) {
  const tenantId = await findRehearsalTenantForMember(db, userId, scope.ids, rehearsalId)
  if (tenantId == null) return NOT_FOUND
  const result = await getRehearsal(db, tenantId, rehearsalId)
  if (result.error) return NOT_FOUND
  const viewerBandMemberId = await getBandMemberIdForUser(db, userId, tenantId)
  return { rehearsal: scope.label({ ...result.rehearsal, viewerBandMemberId }) }
}

export async function setMyRehearsalVote(db, userId, scope, rehearsalId, body = {}) {
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'vote')) return badRequest('Only vote may be updated')
  const tenantId = await findRehearsalTenantForMember(db, userId, scope.ids, rehearsalId)
  if (tenantId == null) return NOT_FOUND
  const memberId = await getBandMemberIdForUser(db, userId, tenantId)
  if (memberId == null) return NOT_FOUND
  const result = await setParticipantVote(
    db, tenantId, userId, rehearsalId, memberId, body, { role: 'reader', isSuperAdmin: false },
  )
  if (result.error) return result.error.status === 403 ? NOT_FOUND : result
  return { rehearsal: scope.label({ ...result.rehearsal, viewerBandMemberId: memberId }) }
}

export async function listMyUpcomingBandEvents(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)

  const result = await limitedCollection(query.limit, (limit) =>
    listUpcomingBandEventsForMemberTenants(db, userId, scope.ids, today, limit))
  if (result.error) return result
  const items = await attachBandEventAvailability(db, userId, scope, result.items)
  return { ...result, items: items.map(scope.label) }
}

export async function listMyPastBandEvents(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)
  const result = await limitedCollectionWithCursor(query.limit, (limit) =>
    listPastBandEventsForMemberTenants(db, userId, scope.ids, today, limit, parsedCursor.cursor),
  (event) => event.end_date)
  if (result.error) return result
  const items = await attachBandEventAvailability(db, userId, scope, result.items)
  return { ...result, items: items.map(scope.label) }
}

export async function getMyBandEvent(db, userId, scope, eventId) {
  const tenantId = await findBandEventTenantForMember(db, userId, scope.ids, eventId)
  if (tenantId == null) return NOT_FOUND
  const result = await getEvent(db, tenantId, eventId, {
    tenantKind: scope.byId.get(tenantId)?.kind, viewer: { userId, tenantId },
  })
  if (result.error) return NOT_FOUND
  return { event: scope.label(result.event) }
}

// Always "assigned to me" — on the hub that is the only meaningful scope, so
// there is deliberately no assignee filter for a client to name.
export async function listMyTasks(db, userId, scope, query = {}) {
  const done = parseTaskDoneFilter(query.done)
  if (done === null) return badRequest('done must be true or false')

  const result = await limitedCollectionWithTotal(query.limit, (limit) =>
    listTasksAssignedToUserForMemberTenants(db, userId, scope.ids, { done, limit }),
  MAX_TASK_LIST_LIMIT)
  if (result.error) return result
  return { ...result, items: result.items.map(scope.label) }
}

export async function setMyTaskDone(db, userId, scope, taskId, body = {}) {
  if (Object.keys(body).length !== 1 || typeof body.done !== 'boolean') return badRequest('Only done may be updated')
  const source = await findAssignedTaskTenantForMember(db, userId, scope.ids, taskId)
  if (!source) return NOT_FOUND
  const result = await patchTask(db, source.tenant_id, taskId, body, {
    role: 'reader', isSuperAdmin: false, userId,
  })
  if (result.error) return result.error.status === 403 ? NOT_FOUND : result
  return { task: scope.label(result.task) }
}

export async function listMyGigMapData(db, userId, scope, query = {}) {
  return windowedCollection(query, async (range) =>
    (await listGigMapDataForMemberTenants(db, userId, scope.ids, range.from, range.to)).map(scope.label))
}
