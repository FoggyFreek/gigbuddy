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

// Slots covering a single date.
export async function listSlotsOnDate(executor, tenantId, date) {
  const { rows } = await executor.query(
    `SELECT * FROM availability_slots
     WHERE tenant_id = $1 AND start_date <= $2 AND end_date >= $2
     ORDER BY created_at ASC`,
    [tenantId, date],
  )
  return rows
}

export async function listBandMembers(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM band_members WHERE tenant_id = $1 ORDER BY sort_order ASC, id ASC',
    [tenantId],
  )
  return rows
}

export async function bandMemberExists(executor, bandMemberId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT id FROM band_members WHERE id = $1 AND tenant_id = $2',
    [bandMemberId, tenantId],
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
