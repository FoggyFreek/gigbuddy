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
import { badRequest } from './serviceErrors.js'
import { parseLocalDate } from '../validators/common.js'
import { MAX_TASK_LIST_LIMIT, parseTaskDoneFilter } from '../validators/taskValidators.js'
import {
  listGigsInRangeForMemberTenants,
  listGigMapDataForMemberTenants,
  listUpcomingGigsForMemberTenants,
} from '../repositories/gigRepository.js'
import {
  listNextPlannedRehearsalForMemberTenants,
  listRehearsalsInRangeForMemberTenants,
} from '../repositories/rehearsalRepository.js'
import {
  listBandEventsInRangeForMemberTenants,
  listUpcomingBandEventsForMemberTenants,
} from '../repositories/bandEventRepository.js'
import { listTasksAssignedToUserForMemberTenants } from '../repositories/taskRepository.js'

const INVALID_TODAY = 'today must be a valid ISO date (YYYY-MM-DD)'

// What every agenda item carries so the UI can say which band it belongs to and
// link into that tenant.
function tenantRef(byId, tenantId) {
  const tenant = byId.get(tenantId)
  return {
    tenantId,
    tenantName: tenant?.displayName ?? null,
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
  return { ...result, items: result.items.map((gig) => label(withoutBanner(gig))) }
}

export async function getMyNextRehearsal(db, userId, memberTenants) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const rehearsal = await listNextPlannedRehearsalForMemberTenants(db, userId, tenantIds)
  return { rehearsal: rehearsal ? withTenantRef(indexTenants(memberTenants))(rehearsal) : null }
}

export async function listMyUpcomingBandEvents(db, userId, memberTenants, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const label = withTenantRef(indexTenants(memberTenants))

  const result = await limitedCollection(query.limit, (limit) =>
    listUpcomingBandEventsForMemberTenants(db, userId, tenantIds, today, limit))
  if (result.error) return result
  return { ...result, items: result.items.map(label) }
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

export async function listMyGigMapData(db, userId, memberTenants, query = {}) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const label = withTenantRef(indexTenants(memberTenants))

  return windowedCollection(query, async (range) =>
    (await listGigMapDataForMemberTenants(db, userId, tenantIds, range.from, range.to)).map(label))
}
