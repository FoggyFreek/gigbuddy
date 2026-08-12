// Data-access helpers for band events. Each query takes an `executor` (a pool or
// transaction client) so callers control transactions. Every query is scoped by
// tenant_id.
import { bandEventScopeSql } from '../../repositories/memberEventScope.js'
import { myBandSelect } from '../../people/my-bands/myBandRepository.js'
import { appendDateCursor } from '../../repositories/listCursorSql.js'

const BAND_EVENT_LIST_PROJECTION = `e.*, ${myBandSelect('e')}`
const BAND_EVENT_START_ASC_ORDER = 'e.start_date ASC, e.id ASC'
const BAND_EVENT_END_DESC_ORDER = 'e.end_date DESC, e.id DESC'

export async function listBandEvents(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${BAND_EVENT_LIST_PROJECTION} FROM band_events e
     WHERE e.tenant_id = $1 ORDER BY ${BAND_EVENT_START_ASC_ORDER}`,
    [tenantId],
  )
  return rows
}

export async function listUpcomingBandEvents(executor, tenantId, today, limit) {
  const { rows } = await executor.query(
    `SELECT ${BAND_EVENT_LIST_PROJECTION} FROM band_events e
     WHERE e.tenant_id = $1 AND e.end_date >= $2
     ORDER BY ${BAND_EVENT_START_ASC_ORDER}
     LIMIT $3`,
    [tenantId, today, limit],
  )
  return rows
}

export async function listPastBandEvents(executor, tenantId, today, limit, cursor = null) {
  const params = [tenantId, today]
  const cursorClause = appendDateCursor(params, cursor, 'e.end_date', 'e.id')
  params.push(limit)
  const { rows } = await executor.query(
    `SELECT ${BAND_EVENT_LIST_PROJECTION} FROM band_events e
     WHERE e.tenant_id = $1 AND e.end_date < $2 ${cursorClause}
     ORDER BY ${BAND_EVENT_END_DESC_ORDER}
     LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function listBandEventsInRange(executor, tenantId, from, to) {
  const { rows } = await executor.query(
    `SELECT ${BAND_EVENT_LIST_PROJECTION} FROM band_events e
     WHERE e.tenant_id = $1 AND e.start_date <= $3 AND e.end_date >= $2
     ORDER BY ${BAND_EVENT_START_ASC_ORDER}`,
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
    `SELECT ${BAND_EVENT_LIST_PROJECTION} FROM band_events e
      WHERE e.tenant_id = ANY($2) AND e.start_date <= $4 AND e.end_date >= $3
        AND ${bandEventScopeSql('e', '$1')}
      ORDER BY ${BAND_EVENT_START_ASC_ORDER}`,
    [userId, tenantIds, from, to],
  )
  return rows
}

// Mirrors listUpcomingBandEvents across every band the caller plays in.
export async function listUpcomingBandEventsForMemberTenants(executor, userId, tenantIds, today, limit) {
  const { rows } = await executor.query(
    `SELECT ${BAND_EVENT_LIST_PROJECTION} FROM band_events e
      WHERE e.tenant_id = ANY($2) AND e.end_date >= $3
        AND ${bandEventScopeSql('e', '$1')}
      ORDER BY ${BAND_EVENT_START_ASC_ORDER}
      LIMIT $4`,
    [userId, tenantIds, today, limit],
  )
  return rows
}

export async function listPastBandEventsForMemberTenants(executor, userId, tenantIds, today, limit, cursor = null) {
  const params = [userId, tenantIds, today]
  const cursorClause = appendDateCursor(params, cursor, 'e.end_date', 'e.id')
  params.push(limit)
  const { rows } = await executor.query(
    `SELECT ${BAND_EVENT_LIST_PROJECTION} FROM band_events e
      WHERE e.tenant_id = ANY($2) AND e.end_date < $3 ${cursorClause}
        AND ${bandEventScopeSql('e', '$1')}
      ORDER BY ${BAND_EVENT_END_DESC_ORDER}
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
    `SELECT *, ${myBandSelect('band_events')} FROM band_events WHERE id = $1 AND tenant_id = $2`,
    [eventId, tenantId],
  )
  return rows[0] || null
}

export async function loadBandEventParticipantIds(executor, eventIds, tenantId) {
  const byEvent = new Map(eventIds.map((id) => [id, []]))
  if (!eventIds.length) return byEvent

  const { rows } = await executor.query(
    `SELECT bep.band_event_id, bep.band_member_id,
            bm.name, bm.color, bm.position, bm.deleted_at
       FROM band_event_participants bep
       JOIN band_members bm ON bm.id = bep.band_member_id AND bm.tenant_id = bep.tenant_id
      WHERE bep.tenant_id = $1 AND bep.band_event_id = ANY($2)
      ORDER BY bep.id ASC`,
    [tenantId, eventIds],
  )
  for (const row of rows) byEvent.get(row.band_event_id)?.push(row)
  return byEvent
}

export async function insertBandEvent(executor, tenantId, data) {
  const { rows } = await executor.query(
    `INSERT INTO band_events (tenant_id, title, start_date, end_date, start_time, end_time, location, notes, my_band_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *, ${myBandSelect('band_events')}`,
    [
      tenantId,
      data.title,
      data.start_date,
      data.end_date,
      data.start_time,
      data.end_time,
      data.location,
      data.notes,
      data.my_band_id ?? null,
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
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *, ${myBandSelect('band_events')}`,
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
