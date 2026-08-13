// Data-access helpers for availability slots. Each query takes an `executor` (a
// pool or transaction client) so callers control transactions. Every query is
// scoped by tenant_id.

// Slots overlapping the [from, to] range (inclusive).
export async function listSlotsInRange(executor, tenantId, from, to) {
  const { rows } = await executor.query(
    `SELECT * FROM availability_slots
     WHERE tenant_id = $1 AND start_date <= $2 AND end_date >= $3
     ORDER BY created_at ASC`,
    [tenantId, to, from],
  )
  return rows
}

export async function listBandMembers(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT * FROM band_members
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY sort_order ASC, id ASC`,
    [tenantId],
  )
  return rows
}

export async function listBookingsForMembersInRange(executor, tenantId, memberIds, from, to) {
  if (!memberIds.length) return []
  const { rows } = await executor.query(
    `SELECT 'gig' AS source, g.id AS source_id, gp.band_member_id,
            g.event_date AS start_date, COALESCE(g.end_date, g.event_date) AS end_date,
            g.start_time, g.end_time, g.event_description AS title
       FROM gigs g
       JOIN gig_participants gp ON gp.gig_id = g.id AND gp.tenant_id = g.tenant_id
      WHERE g.tenant_id = $1 AND gp.band_member_id = ANY($2)
        AND gp.vote IS DISTINCT FROM 'no'
        AND g.event_date BETWEEN ($3::date - 1) AND ($4::date + 1)
     UNION ALL
     SELECT 'rehearsal', r.id, rp.band_member_id,
            r.proposed_date, COALESCE(r.end_date, r.proposed_date), r.start_time, r.end_time, r.location
       FROM rehearsals r
       JOIN rehearsal_participants rp ON rp.rehearsal_id = r.id AND rp.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 AND rp.band_member_id = ANY($2)
        AND rp.vote IS DISTINCT FROM 'no'
        AND r.proposed_date BETWEEN ($3::date - 1) AND ($4::date + 1)
     UNION ALL
     SELECT 'band_event', e.id, bep.band_member_id,
            e.start_date, e.end_date, e.start_time, e.end_time, e.title
       FROM band_events e
       JOIN band_event_participants bep
         ON bep.band_event_id = e.id AND bep.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1 AND bep.band_member_id = ANY($2)
        AND e.start_date <= ($4::date + 1) AND e.end_date >= ($3::date - 1)`,
    [tenantId, memberIds, from, to],
  )
  return rows
}

export async function eventExistsInTenant(executor, tenantId, type, eventId) {
  const table = { gig: 'gigs', rehearsal: 'rehearsals', band_event: 'band_events' }[type]
  if (!table) return false
  const { rowCount } = await executor.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2`,
    [eventId, tenantId],
  )
  return rowCount > 0
}

export async function insertSlot(executor, tenantId, { bandMemberId, startDate, endDate, status, reason }) {
  const { rows } = await executor.query(
    `INSERT INTO availability_slots (tenant_id, band_member_id, start_date, end_date, status, reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, bandMemberId, startDate, endDate, status, reason],
  )
  return rows[0]
}

export async function updateSlotFields(executor, tenantId, slotId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE availability_slots SET ${assignments.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, slotId, tenantId],
  )
  return rows[0] || null
}

export async function deleteSlot(executor, slotId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM availability_slots WHERE id = $1 AND tenant_id = $2',
    [slotId, tenantId],
  )
  return rowCount > 0
}
