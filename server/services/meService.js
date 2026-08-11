// The cross-tenant agenda is the only hub operation that composes owning
// aggregates. The tenant set is derived by resolveMemberTenantIds and is never
// accepted from request input.
import { windowedCollection } from './limitedCollectionService.js'
import { toDateStr } from '../utils/dateOnly.js'
import { listMyGigsInRange } from './meGigService.js'
import { listMyRehearsalsInRange } from './meRehearsalService.js'
import { listMyBandEventsInRange } from './meBandEventService.js'

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
    myBand: row.my_band ?? null,
    ...tenant,
  }
}

export async function listMyAgenda(db, userId, scope, query = {}) {
  return windowedCollection(query, async (range) => {
    const [gigs, rehearsals, bandEvents] = await Promise.all([
      listMyGigsInRange(db, userId, scope, range.from, range.to),
      listMyRehearsalsInRange(db, userId, scope, range.from, range.to),
      listMyBandEventsInRange(db, userId, scope, range.from, range.to),
    ])

    const items = [
      ...gigs.map((gig) => agendaItem('gig', gig, gig.event_date, gig.event_description, scope)),
      ...rehearsals.map((rehearsal) => agendaItem(
        'rehearsal', rehearsal, rehearsal.proposed_date, rehearsal.location, scope,
      )),
      ...bandEvents.map((event) => agendaItem(
        'band_event', event, event.start_date, event.title, scope, event.end_date,
      )),
    ]
    items.sort((a, b) =>
      a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.id - b.id)
    return items
  })
}
