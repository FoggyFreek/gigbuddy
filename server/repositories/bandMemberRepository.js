// Data-access helpers for band members. Each query takes an `executor` (a pool
// or transaction client) so callers control transactions. Every query is scoped
// by tenant_id.

export async function listBandMembers(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM band_members WHERE tenant_id = $1 ORDER BY sort_order ASC, id ASC',
    [tenantId],
  )
  return rows
}

export async function nextSortOrder(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM band_members WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0].next
}

export async function insertBandMember(executor, tenantId, { name, role, color, sortOrder, position }) {
  const { rows } = await executor.query(
    `INSERT INTO band_members (tenant_id, name, role, color, sort_order, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, name, role, color, sortOrder, position],
  )
  return rows[0]
}

export async function updateBandMemberFields(executor, tenantId, memberId, fields, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE band_members SET ${fields.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, memberId, tenantId],
  )
  return rows[0] || null
}

export async function deleteBandMember(executor, memberId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM band_members WHERE id = $1 AND tenant_id = $2',
    [memberId, tenantId],
  )
  return rowCount > 0
}
