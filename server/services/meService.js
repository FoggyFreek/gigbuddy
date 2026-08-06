// The cross-tenant artist agenda: everything the musician is booked for across
// every approved band membership plus their own workspace.
//
// This is the one place that deliberately departs from "every read is scoped by
// req.tenantId", so the rules are spelled out rather than implied:
//
//   - The tenant set arrives on `req.memberTenants` from resolveMemberTenantIds
//     and is derived from approved, non-archived memberships. Nothing here
//     reads a tenant id from the request — a tenant id in a body or query
//     changes nothing.
//   - A tenant the caller can't see is ABSENT from the response, never present
//     and blanked — the same "404, not 403" instinct applied to a payload.
import {
  limitedCollection,
  limitedCollectionWithTotal,
  windowedCollection,
} from './limitedCollectionService.js'
import { badRequest, notFound } from './serviceErrors.js'
import { parseListCursor, parseLocalDate, parseSearchLimit } from '../validators/common.js'
import { MAX_TASK_LIST_LIMIT, parseTaskDoneFilter } from '../validators/taskValidators.js'
import {
  listGigsInRangeForMemberTenants,
  listGigMapDataForMemberTenants,
  listPastGigsForMemberTenants,
  searchGigsForMemberTenants,
  listUpcomingGigsForMemberTenants,
  findGigTenantForMember,
  getBandMemberIdForUser as getGigBandMemberIdForUser,
} from '../repositories/gigRepository.js'
import {
  findRehearsalTenantForMember,
  listNextPlannedRehearsalForMemberTenants,
  listPastRehearsalsForMemberTenants,
  listRehearsalsInRangeForMemberTenants,
  listUpcomingRehearsalsForMemberTenants,
  loadParticipants as loadRehearsalParticipants,
  getBandMemberIdForUser as getRehearsalBandMemberIdForUser,
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
  notifyRehearsalOptionResponsesComplete,
  notifyRehearsalOptionUnavailable,
  setParticipantVote,
} from './rehearsalService.js'
import { enrichEventsWithAvailability, getEvent } from './bandEventService.js'
import { patchTask } from './taskService.js'

const INVALID_TODAY = 'today must be a valid ISO date (YYYY-MM-DD)'
const INVALID_CURSOR = 'cursorDate and cursorId must be a valid date and positive id'
const NOT_FOUND = notFound('Not found')

// What every agenda item carries so the UI can say which band it belongs to and
// link into that tenant.
function tenantRef(byId, tenantId) {
  const tenant = byId.get(tenantId)
  return {
    tenantId,
    tenantName: tenant?.displayName ?? null,
    tenantAvatarPath: tenant?.avatarPath ?? null,
    kind: tenant?.kind ?? null,
  }
}

function indexTenants(memberTenants) {
  return new Map(memberTenants.map((t) => [t.tenantId, t]))
}

// Labels a row with the band it came from. The name comes from memberTenants,
// so no query here ever joins `tenants` just to render one.
const withTenantRef = (byId) => (row) => ({ ...row, ...tenantRef(byId, row.tenant_id) })

// `/api/files/:key` is gated on the *active* tenant, so a banner belonging to
// another band could never be fetched. Drop it rather than emit a path that is
// guaranteed to 404.
const withoutBanner = ({ banner_path: _bannerPath, ...gig }) => gig

function groupsByTenant(rows) {
  const groups = new Map()
  for (const row of rows) {
    const items = groups.get(row.tenant_id) ?? []
    items.push(row)
    groups.set(row.tenant_id, items)
  }
  return groups
}

async function attachRehearsalParticipants(db, userId, rows) {
  const groups = groupsByTenant(rows)
  const enriched = new Map()
  await Promise.all([...groups.entries()].map(async ([tenantId, rehearsals]) => {
    const [byId, viewerBandMemberId] = await Promise.all([
      loadRehearsalParticipants(db, rehearsals.map((r) => r.id), tenantId),
      getRehearsalBandMemberIdForUser(db, userId, tenantId),
    ])
    rehearsals.forEach((r) => enriched.set(r.id, {
      ...r, participants: byId.get(r.id) ?? [], viewerBandMemberId,
    }))
  }))
  return rows.map((row) => enriched.get(row.id))
}

async function attachGigAvailability(db, userId, rows) {
  const groups = groupsByTenant(rows)
  const enriched = new Map()
  await Promise.all([...groups.entries()].map(async ([tenantId, gigs]) => {
    const items = await enrichGigsWithAvailability(db, tenantId, gigs, { userId, tenantId })
    items.forEach((gig) => enriched.set(gig.id, gig))
  }))
  return rows.map((row) => enriched.get(row.id))
}

async function attachBandEventAvailability(db, userId, memberTenants, rows, withDays = false) {
  const byTenant = indexTenants(memberTenants)
  const groups = groupsByTenant(rows)
  const enriched = new Map()
  await Promise.all([...groups.entries()].map(async ([tenantId, events]) => {
    const tenant = byTenant.get(tenantId)
    const items = await enrichEventsWithAvailability(db, tenantId, {
      tenantKind: tenant?.kind,
      viewer: { userId, tenantId },
      withDays,
    }, events)
    items.forEach((event) => enriched.set(event.id, event))
  }))
  return rows.map((row) => enriched.get(row.id))
}

const toDateStr = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)

// One agenda row, whatever the underlying entity. `type` + `id` identify the
// source so the frontend can build the right in-tenant link.
function agendaItem(type, row, date, title, byId, endDate = date) {
  const tenant = tenantRef(byId, row.tenant_id)
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
    ...tenant,
  }
}

export async function listMyAgenda(db, userId, memberTenants, query = {}) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const byId = indexTenants(memberTenants)

  return windowedCollection(query, async (range) => {
    const [gigs, rehearsals, bandEvents] = await Promise.all([
      listGigsInRangeForMemberTenants(db, userId, tenantIds, range.from, range.to),
      listRehearsalsInRangeForMemberTenants(db, userId, tenantIds, range.from, range.to),
      listBandEventsInRangeForMemberTenants(db, userId, tenantIds, range.from, range.to),
    ])

    const items = [
      ...gigs.map((g) => agendaItem('gig', g, g.event_date, g.event_description, byId)),
      ...rehearsals.map((r) => agendaItem('rehearsal', r, r.proposed_date, r.location, byId)),
      ...bandEvents.map((e) => agendaItem('band_event', e, e.start_date, e.title, byId, e.end_date)),
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

export async function listMyUpcomingGigs(db, userId, memberTenants, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const label = withTenantRef(indexTenants(memberTenants))

  const result = await limitedCollectionWithTotal(query.limit, (limit) =>
    listUpcomingGigsForMemberTenants(db, userId, tenantIds, today, limit))
  if (result.error) return result
  const items = await attachGigAvailability(db, userId, result.items)
  return { ...result, items: items.map((gig) => label(withoutBanner(gig))) }
}

export async function listMyPastGigs(db, userId, memberTenants, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const label = withTenantRef(indexTenants(memberTenants))
  const result = await limitedCollection(query.limit, (limit) =>
    listPastGigsForMemberTenants(db, userId, tenantIds, today, limit, parsedCursor.cursor))
  if (result.error) return result
  const items = await attachGigAvailability(db, userId, result.items)
  const labeled = items.map((gig) => label(withoutBanner(gig)))
  const last = labeled[labeled.length - 1]
  return {
    items: labeled,
    meta: {
      ...result.meta,
      nextCursor: last && labeled.length === result.meta.limit
        ? { date: toDateStr(last.event_date), id: last.id }
        : null,
    },
  }
}

export async function searchMyGigs(db, userId, memberTenants, query = {}) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  const rows = await searchGigsForMemberTenants(db, userId, memberTenants.map((t) => t.tenantId), {
    like: `%${q}%`, limit: parseSearchLimit(query.limit),
  })
  const label = withTenantRef(indexTenants(memberTenants))
  return rows.map((gig) => label(withoutBanner(gig)))
}

export async function getMyGig(db, userId, memberTenants, gigId) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const tenantId = await findGigTenantForMember(db, userId, tenantIds, gigId)
  if (tenantId == null) return NOT_FOUND
  const result = await getGig(db, tenantId, gigId)
  if (result.error) return NOT_FOUND
  const tenant = indexTenants(memberTenants).get(tenantId)
  if (tenant?.kind === 'personal') {
    return { gig: withTenantRef(indexTenants(memberTenants))(result.gig) }
  }
  const memberId = await getGigBandMemberIdForUser(db, userId, tenantId)
  const attachments = (result.gig.attachments ?? []).map(({ object_key: _objectKey, ...attachment }) => attachment)
  const tasks = (result.gig.tasks ?? []).filter((task) => task.assigned_to === memberId)
  const { participants: _participants, ...withoutParticipants } = result.gig
  return {
    gig: withTenantRef(indexTenants(memberTenants))({
      ...withoutBanner(withoutParticipants), attachments, tasks, viewerBandMemberId: memberId,
    }),
  }
}

export async function getMyNextRehearsal(db, userId, memberTenants) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const rehearsal = await listNextPlannedRehearsalForMemberTenants(db, userId, tenantIds)
  return { rehearsal: rehearsal ? withTenantRef(indexTenants(memberTenants))(rehearsal) : null }
}

export async function listMyUpcomingRehearsals(db, userId, memberTenants, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const result = await limitedCollection(query.limit, (limit) =>
    listUpcomingRehearsalsForMemberTenants(db, userId, memberTenants.map((t) => t.tenantId), today, limit))
  if (result.error) return result
  const label = withTenantRef(indexTenants(memberTenants))
  return { ...result, items: (await attachRehearsalParticipants(db, userId, result.items)).map(label) }
}

export async function listMyPastRehearsals(db, userId, memberTenants, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)
  const result = await limitedCollection(query.limit, (limit) =>
    listPastRehearsalsForMemberTenants(
      db, userId, memberTenants.map((t) => t.tenantId), today, limit, parsedCursor.cursor,
    ))
  if (result.error) return result
  const label = withTenantRef(indexTenants(memberTenants))
  const items = (await attachRehearsalParticipants(db, userId, result.items)).map(label)
  const last = items[items.length - 1]
  return { items, meta: { ...result.meta, nextCursor: last && items.length === result.meta.limit
    ? { date: toDateStr(last.proposed_date), id: last.id } : null } }
}

export async function getMyRehearsal(db, userId, memberTenants, rehearsalId) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const tenantId = await findRehearsalTenantForMember(db, userId, tenantIds, rehearsalId)
  if (tenantId == null) return NOT_FOUND
  const result = await getRehearsal(db, tenantId, rehearsalId)
  if (result.error) return NOT_FOUND
  const viewerBandMemberId = await getRehearsalBandMemberIdForUser(db, userId, tenantId)
  return { rehearsal: withTenantRef(indexTenants(memberTenants))({ ...result.rehearsal, viewerBandMemberId }) }
}

export async function setMyRehearsalVote(db, userId, memberTenants, rehearsalId, body = {}) {
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'vote')) return badRequest('Only vote may be updated')
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const tenantId = await findRehearsalTenantForMember(db, userId, tenantIds, rehearsalId)
  if (tenantId == null) return NOT_FOUND
  const memberId = await getRehearsalBandMemberIdForUser(db, userId, tenantId)
  if (memberId == null) return NOT_FOUND
  const result = await setParticipantVote(
    db, tenantId, userId, rehearsalId, memberId, body, { role: 'reader', isSuperAdmin: false },
  )
  if (result.error) return result.error.status === 403 ? NOT_FOUND : result
  if (result.notifications.firstUnavailable) await notifyRehearsalOptionUnavailable(tenantId, result.rehearsal)
  if (result.notifications.allResponded) await notifyRehearsalOptionResponsesComplete(tenantId, result.rehearsal)
  return { rehearsal: withTenantRef(indexTenants(memberTenants))({ ...result.rehearsal, viewerBandMemberId: memberId }) }
}

export async function listMyUpcomingBandEvents(db, userId, memberTenants, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const label = withTenantRef(indexTenants(memberTenants))

  const result = await limitedCollection(query.limit, (limit) =>
    listUpcomingBandEventsForMemberTenants(db, userId, tenantIds, today, limit))
  if (result.error) return result
  return { ...result, items: (await attachBandEventAvailability(db, userId, memberTenants, result.items)).map(label) }
}

export async function listMyPastBandEvents(db, userId, memberTenants, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)
  const result = await limitedCollection(query.limit, (limit) =>
    listPastBandEventsForMemberTenants(
      db, userId, memberTenants.map((t) => t.tenantId), today, limit, parsedCursor.cursor,
    ))
  if (result.error) return result
  const label = withTenantRef(indexTenants(memberTenants))
  const items = (await attachBandEventAvailability(db, userId, memberTenants, result.items)).map(label)
  const last = items[items.length - 1]
  return { items, meta: { ...result.meta, nextCursor: last && items.length === result.meta.limit
    ? { date: toDateStr(last.end_date), id: last.id } : null } }
}

export async function getMyBandEvent(db, userId, memberTenants, eventId) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const tenantId = await findBandEventTenantForMember(db, userId, tenantIds, eventId)
  if (tenantId == null) return NOT_FOUND
  const tenant = indexTenants(memberTenants).get(tenantId)
  const result = await getEvent(db, tenantId, eventId, {
    tenantKind: tenant?.kind, viewer: { userId, tenantId },
  })
  if (result.error) return NOT_FOUND
  return { event: withTenantRef(indexTenants(memberTenants))(result.event) }
}

// Always "assigned to me" — on the hub that is the only meaningful scope, so
// there is deliberately no assignee filter for a client to name.
export async function listMyTasks(db, userId, memberTenants, query = {}) {
  const done = parseTaskDoneFilter(query.done)
  if (done === null) return badRequest('done must be true or false')
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const label = withTenantRef(indexTenants(memberTenants))

  const result = await limitedCollectionWithTotal(query.limit, (limit) =>
    listTasksAssignedToUserForMemberTenants(db, userId, tenantIds, { done, limit }),
  MAX_TASK_LIST_LIMIT)
  if (result.error) return result
  return { ...result, items: result.items.map(label) }
}

export async function setMyTaskDone(db, userId, memberTenants, taskId, body = {}) {
  if (Object.keys(body).length !== 1 || typeof body.done !== 'boolean') return badRequest('Only done may be updated')
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const source = await findAssignedTaskTenantForMember(db, userId, tenantIds, taskId)
  if (!source) return NOT_FOUND
  const result = await patchTask(db, source.tenant_id, taskId, body, {
    role: 'reader', isSuperAdmin: false, userId,
  })
  if (result.error) return result.error.status === 403 ? NOT_FOUND : result
  return { task: withTenantRef(indexTenants(memberTenants))(result.task) }
}

export async function listMyGigMapData(db, userId, memberTenants, query = {}) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const label = withTenantRef(indexTenants(memberTenants))

  return windowedCollection(query, async (range) =>
    (await listGigMapDataForMemberTenants(db, userId, tenantIds, range.from, range.to)).map(label))
}
