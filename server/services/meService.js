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
import { windowedCollection } from './limitedCollectionService.js'
import { listGigsInRangeForMemberTenants } from '../repositories/gigRepository.js'
import { listRehearsalsInRangeForMemberTenants } from '../repositories/rehearsalRepository.js'
import { listBandEventsInRangeForMemberTenants } from '../repositories/bandEventRepository.js'

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
