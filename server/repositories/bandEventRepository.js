// Data-access helpers for band events. Each query takes an `executor` (a pool or
// transaction client) so callers control transactions. Every query is scoped by
// tenant_id.

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

export async function fetchBandEvent(executor, eventId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM band_events WHERE id = $1 AND tenant_id = $2',
    [eventId, tenantId],
  )
  return rows[0] || null
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
