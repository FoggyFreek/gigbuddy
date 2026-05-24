// Data-access helpers and shared SQL fragments for gigs. Each query takes an
// `executor` (a pool or transaction client) so callers control transactions.

export const VENUE_JSON_SELECT = `CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id', v.id,
  'name', v.name,
  'category', v.category,
  'organization_name', v.organization_name,
  'city', v.city,
  'region', v.region,
  'postal_code', v.postal_code,
  'country', v.country
) END AS venue`

export const FESTIVAL_JSON_SELECT = `CASE WHEN fv.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id', fv.id,
  'name', fv.name,
  'category', fv.category,
  'organization_name', fv.organization_name,
  'city', fv.city,
  'region', fv.region,
  'postal_code', fv.postal_code,
  'country', fv.country
) END AS festival`

export const VENUE_JOIN = `LEFT JOIN venues v ON v.id = g.venue_id AND v.tenant_id = g.tenant_id`
export const FESTIVAL_JOIN = `LEFT JOIN venues fv ON fv.id = g.festival_id AND fv.tenant_id = g.tenant_id`

// Throws a 400 Error when venueId is set but does not reference a row of the
// expected category in the tenant. A null/undefined id is a no-op.
export async function assertVenueInTenant(executor, venueId, tenantId, expectedCategory = null) {
  if (venueId === null || venueId === undefined) return
  let sql = 'SELECT 1 FROM venues WHERE id = $1 AND tenant_id = $2'
  const params = [venueId, tenantId]
  if (expectedCategory) {
    sql += ' AND category = $3'
    params.push(expectedCategory)
  }
  const { rowCount } = await executor.query(sql, params)
  if (!rowCount) {
    const fieldName = expectedCategory === 'festival' ? 'festival_id' : 'venue_id'
    const err = new Error(`Invalid ${fieldName}`)
    err.status = 400
    throw err
  }
}

export async function memberExistsInTenant(executor, memberId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM band_members WHERE id = $1 AND tenant_id = $2',
    [memberId, tenantId],
  )
  return rowCount > 0
}

export async function gigExistsInTenant(executor, gigId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  return rowCount > 0
}

export async function loadParticipants(executor, gigIds, tenantId) {
  if (!gigIds.length) return new Map()
  const { rows } = await executor.query(
    `SELECT gp.gig_id, gp.band_member_id, gp.vote,
            bm.name, bm.color, bm.position
     FROM gig_participants gp
     JOIN band_members bm ON bm.id = gp.band_member_id AND bm.tenant_id = $2
     WHERE gp.gig_id = ANY($1) AND gp.tenant_id = $2
     ORDER BY bm.sort_order ASC, bm.id ASC`,
    [gigIds, tenantId],
  )
  const byGig = new Map()
  for (const id of gigIds) byGig.set(id, [])
  for (const row of rows) {
    byGig.get(row.gig_id).push({
      band_member_id: row.band_member_id,
      name: row.name,
      color: row.color,
      position: row.position,
      vote: row.vote,
    })
  }
  return byGig
}

export async function fetchGigWithRelations(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    `SELECT g.*, ${VENUE_JSON_SELECT}, ${FESTIVAL_JSON_SELECT}
       FROM gigs g
       ${VENUE_JOIN}
       ${FESTIVAL_JOIN}
      WHERE g.id = $1 AND g.tenant_id = $2`,
    [gigId, tenantId],
  )
  return rows[0] || null
}

// Applies prebuilt SET fragments (placeholders $1..$N) to a gig, appending
// updated_at and the WHERE bindings. Returns the updated gig with relations, or
// null when no matching row exists.
export async function updateGigFields(executor, tenantId, gigId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `WITH updated AS (
       UPDATE gigs SET ${assignments.join(', ')}
       WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1}
       RETURNING *
     )
     SELECT g.*, ${VENUE_JSON_SELECT}, ${FESTIVAL_JSON_SELECT}
       FROM updated g
       ${VENUE_JOIN}
       ${FESTIVAL_JOIN}`,
    [...values, gigId, tenantId],
  )
  return rows[0] || null
}

// Applies prebuilt SET fragments to a gig task. Returns the updated task row, or
// null when no matching row exists.
export async function updateGigTaskFields(executor, tenantId, gigId, taskId, fields, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE gig_tasks SET ${fields.join(', ')}
     WHERE id = $${whereIdx} AND gig_id = $${whereIdx + 1} AND tenant_id = $${whereIdx + 2} RETURNING *`,
    [...values, taskId, gigId, tenantId],
  )
  return rows[0] || null
}
