// Data-access helpers for band events. Each query takes an `executor` (a pool or
// transaction client) so callers control transactions. Every query is scoped by
// tenant_id.
import { bandEventScopeSql } from './memberEventScope.js'

export async function listBandEvents(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM band_events WHERE tenant_id = $1 ORDER BY start_date ASC, id ASC',
    [tenantId],
  )
  return rows
}

export async function listUpcomingBandEvents(executor, tenantId, today, limit) {
  const { rows } = await executor.query(
    `SELECT * FROM band_events
     WHERE tenant_id = $1 AND end_date >= $2
     ORDER BY start_date ASC, id ASC
     LIMIT $3`,
    [tenantId, today, limit],
  )
  return rows
}

export async function listPastBandEvents(executor, tenantId, today, limit, cursor = null) {
  const params = [tenantId, today]
  let cursorClause = ''
  if (cursor) {
    params.push(cursor.date, cursor.id)
    cursorClause = `AND (end_date, id) < ($${params.length - 1}, $${params.length})`
  }
  params.push(limit)
  const { rows } = await executor.query(
    `SELECT * FROM band_events
     WHERE tenant_id = $1 AND end_date < $2 ${cursorClause}
     ORDER BY end_date DESC, id DESC
     LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function listBandEventsInRange(executor, tenantId, from, to) {
  const { rows } = await executor.query(
    `SELECT * FROM band_events
     WHERE tenant_id = $1 AND start_date <= $3 AND end_date >= $2
     ORDER BY start_date ASC, id ASC`,
    [tenantId, from, to],
  )
  return rows
}

// Cross-tenant artist calendar read (/api/me/agenda). Interval overlap, so a multi-day event that
// straddles a window bound still appears. Tenant ids come from the caller's
// approved memberships, never from the client; band events additionally need
// a participant linked to the caller.
export async function listBandEventsInRangeForMemberTenants(executor, userId, tenantIds, from, to) {
  const { rows } = await executor.query(
    `SELECT e.* FROM band_events e
      WHERE e.tenant_id = ANY($2) AND e.start_date <= $4 AND e.end_date >= $3
        AND ${bandEventScopeSql('e', '$1')}
      ORDER BY e.start_date ASC, e.id ASC`,
    [userId, tenantIds, from, to],
  )
  return rows
}

// Mirrors listUpcomingBandEvents across every band the caller plays in.
export async function listUpcomingBandEventsForMemberTenants(executor, userId, tenantIds, today, limit) {
  const { rows } = await executor.query(
    `SELECT e.* FROM band_events e
      WHERE e.tenant_id = ANY($2) AND e.end_date >= $3
        AND ${bandEventScopeSql('e', '$1')}
      ORDER BY e.start_date ASC, e.id ASC
      LIMIT $4`,
    [userId, tenantIds, today, limit],
  )
  return rows
}

export async function listPastBandEventsForMemberTenants(executor, userId, tenantIds, today, limit, cursor = null) {
  const params = [userId, tenantIds, today]
  let cursorClause = ''
  if (cursor) {
    params.push(cursor.date, cursor.id)
    cursorClause = `AND (e.end_date, e.id) < ($${params.length - 1}, $${params.length})`
  }
  params.push(limit)
  const { rows } = await executor.query(
    `SELECT e.* FROM band_events e
      WHERE e.tenant_id = ANY($2) AND e.end_date < $3 ${cursorClause}
        AND ${bandEventScopeSql('e', '$1')}
      ORDER BY e.end_date DESC, e.id DESC
      LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function findBandEventTenantForMember(executor, userId, tenantIds, eventId) {
  const { rows } = await executor.query(
    `SELECT e.tenant_id FROM band_events e
      WHERE e.id = $3 AND e.tenant_id = ANY($2)
        AND ${bandEventScopeSql('e', '$1')}`,
    [userId, tenantIds, eventId],
  )
  return rows[0]?.tenant_id ?? null
}

export async function fetchBandEvent(executor, eventId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM band_events WHERE id = $1 AND tenant_id = $2',
    [eventId, tenantId],
  )
  return rows[0] || null
}

export async function loadBandEventParticipantIds(executor, eventIds, tenantId) {
  const byEvent = new Map(eventIds.map((id) => [id, []]))
  if (!eventIds.length) return byEvent

  const { rows } = await executor.query(
    `SELECT band_event_id, band_member_id
       FROM band_event_participants
      WHERE tenant_id = $1 AND band_event_id = ANY($2)
      ORDER BY id ASC`,
    [tenantId, eventIds],
  )
  for (const row of rows) byEvent.get(row.band_event_id)?.push(row.band_member_id)
  return byEvent
}

export async function insertBandEvent(executor, tenantId, data) {
  const { rows } = await executor.query(
    `INSERT INTO band_events (tenant_id, title, start_date, end_date, start_time, end_time, location, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      tenantId,
      data.title,
      data.start_date,
      data.end_date,
      data.start_time,
      data.end_time,
      data.location,
      data.notes,
    ],
  )
  return rows[0]
}

export async function insertBandEventParticipant(executor, tenantId, eventId, memberId) {
  await executor.query(
    `INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
     VALUES ($1, $2, $3)`,
    [tenantId, eventId, memberId],
  )
}

export async function deleteBandEventParticipant(executor, tenantId, eventId, memberId) {
  const { rowCount } = await executor.query(
    `DELETE FROM band_event_participants
      WHERE tenant_id = $1 AND band_event_id = $2 AND band_member_id = $3`,
    [tenantId, eventId, memberId],
  )
  return rowCount > 0
}

export async function updateBandEventFields(executor, tenantId, eventId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE band_events SET ${assignments.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, eventId, tenantId],
  )
  return rows[0] || null
}

export async function deleteBandEvent(executor, eventId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM band_events WHERE id = $1 AND tenant_id = $2',
    [eventId, tenantId],
  )
  return rowCount > 0
}
