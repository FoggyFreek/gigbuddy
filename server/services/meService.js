// The cross-tenant hub (/api/me): "everything I'm booked for" and "where my
// money comes from", read-only, across every band the musician is an approved
// member of plus their own workspace.
//
// This is the one place that deliberately departs from "every read is scoped by
// req.tenantId", so the rules are spelled out rather than implied:
//
//   - The tenant set arrives on `req.memberTenants` from resolveMemberTenantIds
//     and is derived from approved, non-archived memberships. Nothing here
//     reads a tenant id from the request — a tenant id in a body or query
//     changes nothing.
//   - Every read is read-only. Nothing in the hub writes, and nothing posts to
//     a ledger. Aggregation is display only.
//   - Two sets of books stay two sets of books: earnings are reported PER
//     TENANT and never summed. A band's gig revenue and the musician's fee for
//     that gig are the same money seen from two sides.
//   - A tenant the caller can't see is ABSENT from the response, never present
//     and blanked — the same "404, not 403" instinct applied to a payload.
import { PERMISSIONS, hasPermission } from '../auth/permissions.js'
import { limitedCollection, windowedCollection } from './limitedCollectionService.js'
import { parseListCursor, parseLocalDate } from '../validators/common.js'
import { badRequest } from './serviceErrors.js'
import {
  listGigsInRangeForMemberTenants,
  listPastGigsForMemberTenants,
} from '../repositories/gigRepository.js'
import { listRehearsalsInRangeForMemberTenants } from '../repositories/rehearsalRepository.js'
import { listBandEventsInRangeForMemberTenants } from '../repositories/bandEventRepository.js'
import { resultTotalsByTenant } from '../repositories/ledgerRepository.js'

const INVALID_TODAY = 'today must be a valid ISO date (YYYY-MM-DD)'
const INVALID_CURSOR = 'cursorDate and cursorId must be supplied together and be valid'

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
function agendaItem(type, row, date, title, byId) {
  return {
    type,
    id: row.id,
    date: toDateStr(date),
    title: title ?? null,
    status: row.status ?? null,
    ...tenantRef(byId, row.tenant_id),
  }
}

export async function listMyBands(db, memberTenants) {
  // Phase 4 unions external ensembles (organisation contacts in the personal
  // workspace) here; `source` is what tells the two apart.
  return {
    items: memberTenants.map((t) => ({
      source: 'tenant',
      tenantId: t.tenantId,
      displayName: t.displayName,
      slug: t.slug,
      kind: t.kind,
      role: t.role,
      logoPath: t.logoPath,
    })),
  }
}

export async function listMyAgenda(db, memberTenants, query = {}) {
  const tenantIds = memberTenants.map((t) => t.tenantId)
  const byId = indexTenants(memberTenants)

  return windowedCollection(query, async (range) => {
    const [gigs, rehearsals, bandEvents] = await Promise.all([
      listGigsInRangeForMemberTenants(db, tenantIds, range.from, range.to),
      listRehearsalsInRangeForMemberTenants(db, tenantIds, range.from, range.to),
      listBandEventsInRangeForMemberTenants(db, tenantIds, range.from, range.to),
    ])

    const items = [
      ...gigs.map((g) => agendaItem('gig', g, g.event_date, g.event_description, byId)),
      ...rehearsals.map((r) => agendaItem('rehearsal', r, r.proposed_date, r.location, byId)),
      ...bandEvents.map((e) => agendaItem('band_event', e, e.start_date, e.title, byId)),
    ]
    // One chronological feed across every band. The (type, id) tiebreak keeps
    // the order stable when two items share a date.
    items.sort((a, b) =>
      a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.id - b.id)
    return items
  })
}

// Deep "load more" history. Gigs only: `gigs.id` is a global primary key, so
// (event_date, id) is a total order across tenants and the keyset cursor is
// safe — a union of three tables would need a wider key.
export async function listMyPastAgenda(db, memberTenants, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)

  const tenantIds = memberTenants.map((t) => t.tenantId)
  const byId = indexTenants(memberTenants)

  const result = await limitedCollection(query.limit, (limit) =>
    listPastGigsForMemberTenants(db, tenantIds, today, limit, parsedCursor.cursor))
  if (result.error) return result

  const items = result.items.map((g) => agendaItem('gig', g, g.event_date, g.event_description, byId))
  const last = items[items.length - 1]
  // Null once the page is short of `limit` — that is the end of the feed.
  const nextCursor = last && items.length === result.meta.limit
    ? { date: last.date, id: last.id }
    : null

  return { items, meta: { ...result.meta, nextCursor } }
}

// Per band, never a single total. A band whose permission matrix denies
// finance.view to the caller's role drops out of the rollup rather than
// failing the whole request — the hub degrades, it doesn't 403.
export async function listMyEarnings(db, user, memberTenants, query = {}) {
  const visible = memberTenants.filter((t) =>
    hasPermission(t.role, PERMISSIONS.FINANCE_VIEW, { isSuperAdmin: !!user?.is_super_admin }))
  const tenantIds = visible.map((t) => t.tenantId)

  return windowedCollection(query, async (range) => {
    // Half-open [from, toExclusive) at the repository, per the finance
    // convention, from the inclusive day window the API speaks.
    const toExclusive = nextDay(range.to)
    const rows = await resultTotalsByTenant(db, tenantIds, { from: range.from, toExclusive })
    const totalsById = new Map(rows.map((r) => [r.tenant_id, r]))

    return visible.map((t) => {
      const totals = totalsById.get(t.tenantId)
      const revenueCents = totals?.revenue_cents ?? 0
      const expenseCents = totals?.expense_cents ?? 0
      return {
        tenantId: t.tenantId,
        tenantName: t.displayName,
        kind: t.kind,
        revenueCents,
        expenseCents,
        // This band's own figure, on its own books. Never added to another's.
        resultCents: revenueCents - expenseCents,
      }
    })
  })
}

function nextDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
