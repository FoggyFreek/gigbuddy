import { loadSharedUserAvailability } from '../availability/availabilityService.js'
import { toDateStr } from '../../utils/dateOnly.js'

// Tenant-scoped enrichers cannot consume an interleaved hub feed directly.
// Group rows by tenant, enrich each group, then restore the repository order.
export async function enrichPerTenant(rows, enrich) {
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

// The user-level half of availability is independent of the viewing tenant.
// A hub feed fetches it once and shares it with every tenant-scoped matrix.
export async function loadFeedUserAvailability(db, rows, dateOf, endDateOf = dateOf) {
  const tenantIds = [...new Set(rows.map((row) => row.tenant_id))]
  const dates = rows.map(dateOf).map(toDateStr).filter(Boolean)
  if (!tenantIds.length || !dates.length) return null

  const ends = rows.map((row) => toDateStr(endDateOf(row)) ?? toDateStr(dateOf(row))).filter(Boolean)
  return loadSharedUserAvailability(
    db,
    tenantIds,
    dates.reduce((a, b) => (a < b ? a : b)),
    ends.reduce((a, b) => (a > b ? a : b)),
  )
}
