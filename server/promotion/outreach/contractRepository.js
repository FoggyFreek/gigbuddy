export async function lockContractReference(executor, tenantId, year) {
  await executor.query('SELECT pg_advisory_xact_lock($1, $2)', [tenantId, year])
}
export async function nextContractSequence(executor, tenantId, year) {
  const { rows } = await executor.query(
    `SELECT COALESCE(MAX(substring(reference from '[0-9]+$')::int), 0) + 1 AS next
       FROM gig_contracts WHERE tenant_id = $1 AND reference LIKE $2`, [tenantId, `${year}-%`])
  return rows[0].next
}
export async function nextContractVersion(executor, tenantId, gigId) {
  const { rows } = await executor.query('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM gig_contracts WHERE tenant_id = $1 AND gig_id = $2', [tenantId, gigId])
  return rows[0].next
}
export async function insertContract(executor, tenantId, data) {
  const { rows } = await executor.query(
    `INSERT INTO gig_contracts (tenant_id, gig_id, reference, version, locale, terms_snapshot, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenantId, data.gigId, data.reference, data.version, data.locale, data.termsSnapshot, data.userId])
  return rows[0]
}
export async function updateContractPdf(executor, tenantId, contractId, objectKey, bytes) {
  const { rows } = await executor.query('UPDATE gig_contracts SET pdf_object_key = $3, pdf_bytes = $4, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *', [contractId, tenantId, objectKey, bytes])
  return rows[0] ?? null
}
export async function fetchContract(executor, tenantId, contractId) {
  const { rows } = await executor.query('SELECT * FROM gig_contracts WHERE id = $1 AND tenant_id = $2', [contractId, tenantId])
  return rows[0] ?? null
}
export async function listContractRows(executor, tenantId, gigId, limit) {
  const { rows } = await executor.query('SELECT * FROM gig_contracts WHERE gig_id = $1 AND tenant_id = $2 ORDER BY version DESC, id DESC LIMIT $3', [gigId, tenantId, limit])
  return rows
}
export async function countersignContractRow(executor, tenantId, contractId, date, note) {
  const { rows } = await executor.query(
    `UPDATE gig_contracts SET status = 'countersigned', countersigned_at = $3, countersigned_note = $4, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND status IN ('draft','sent') RETURNING *`, [contractId, tenantId, date, note])
  return rows[0] ?? null
}
export async function voidContractRow(executor, tenantId, contractId) {
  const { rows } = await executor.query("UPDATE gig_contracts SET status = 'void', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 AND status <> 'countersigned' RETURNING *", [contractId, tenantId])
  return rows[0] ?? null
}
export async function markContractSent(executor, tenantId, contractId, campaignId) {
  const { rows } = await executor.query(
    `UPDATE gig_contracts SET status = 'sent', sent_campaign_id = $4, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND status = $3 RETURNING *`,
    [contractId, tenantId, 'draft', campaignId],
  )
  return rows[0] ?? null
}
