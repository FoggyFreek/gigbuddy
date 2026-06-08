// Data-access helpers for purchases. Each takes an `executor` (a pool or a
// transaction client) so callers control transaction boundaries.

export async function fetchPurchase(executor, tenantId, purchaseId) {
  const { rows } = await executor.query(
    'SELECT * FROM purchases WHERE id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  return rows[0] || null
}

export async function fetchPurchaseLines(executor, purchaseId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, description, expense_category, tax_rate, amount_incl_cents, position
       FROM purchase_lines
      WHERE purchase_id = $1 AND tenant_id = $2
      ORDER BY position ASC, id ASC`,
    [purchaseId, tenantId],
  )
  return rows
}

export async function nextPurchaseNumber(executor, tenantId) {
  const { rows } = await executor.query(
    `INSERT INTO purchase_number_sequences (tenant_id, next_seq)
     VALUES ($1, 2)
     ON CONFLICT (tenant_id)
     DO UPDATE SET next_seq = purchase_number_sequences.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    [tenantId],
  )
  return rows[0].seq
}

export async function insertPurchaseLines(executor, purchaseId, tenantId, lines) {
  for (const line of lines) {
    await executor.query(
      `INSERT INTO purchase_lines (purchase_id, tenant_id, position, description, expense_category, tax_rate, amount_incl_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [purchaseId, tenantId, line.position, line.description, line.expense_category, line.tax_rate, line.amount_incl_cents],
    )
  }
}

export async function replacePurchaseLines(executor, purchaseId, tenantId, lines) {
  await executor.query(
    'DELETE FROM purchase_lines WHERE purchase_id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  await insertPurchaseLines(executor, purchaseId, tenantId, lines)
}

// Returns the int id only if a contact with that (id, tenant_id) exists.
// Mirrors validateGigIdForTenant so a cross-tenant supplier is rejected up front.
export async function validateContactIdForTenant(executor, rawId, tenantId) {
  const n = Number(rawId)
  if (!Number.isInteger(n) || n <= 0) return null
  const { rowCount } = await executor.query(
    'SELECT 1 FROM contacts WHERE id = $1 AND tenant_id = $2',
    [n, tenantId],
  )
  return rowCount ? n : null
}
