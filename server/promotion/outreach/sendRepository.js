export async function listSuppressionRows(executor, tenantId, limit) {
  const { rows } = await executor.query('SELECT * FROM outreach_suppressions WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [tenantId, limit])
  return rows
}
export async function addSuppressionRow(executor, tenantId, email, reason) {
  const { rows } = await executor.query(
    `INSERT INTO outreach_suppressions (tenant_id, email, reason) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, lower(email)) DO UPDATE SET reason = EXCLUDED.reason RETURNING *`, [tenantId, email, reason])
  return rows[0]
}
export async function deleteSuppressionRow(executor, tenantId, id) {
  const { rowCount } = await executor.query('DELETE FROM outreach_suppressions WHERE id = $1 AND tenant_id = $2', [id, tenantId])
  return rowCount > 0
}
export async function isSuppressed(executor, tenantId, email) {
  const { rowCount } = await executor.query('SELECT 1 FROM outreach_suppressions WHERE tenant_id = $1 AND lower(email) = lower($2)', [tenantId, email])
  return rowCount > 0
}
