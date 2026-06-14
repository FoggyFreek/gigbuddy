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
    `SELECT id, description, expense_category, account_code, tax_rate, amount_incl_cents, position, product_id, quantity
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
      `INSERT INTO purchase_lines (purchase_id, tenant_id, position, description, expense_category, account_code, tax_rate, amount_incl_cents, product_id, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [purchaseId, tenantId, line.position, line.description, line.expense_category, line.account_code ?? null, line.tax_rate, line.amount_incl_cents, line.product_id ?? null, line.quantity ?? null],
    )
  }
}

// Returns the subset of `codes` a purchase line may book to: active expense or
// cost-of-goods-sold accounts (the 5xxxx/6xxxx codes a bill may debit), plus
// active asset accounts explicitly flagged `is_capitalizable` (owned gear,
// vehicles) so a purchase can be capitalized onto the balance sheet rather than
// expensed. Other assets (bank, VAT, receivable, inventory) are excluded.
// The line FK only proves existence; this also enforces active + allowed type.
export async function fetchValidPurchaseLineCodes(executor, tenantId, codes) {
  const unique = [...new Set(codes.filter(Boolean))]
  if (!unique.length) return new Set()
  const { rows } = await executor.query(
    `SELECT code FROM chart_of_accounts
      WHERE tenant_id = $1 AND code = ANY($2) AND is_active
        AND (type IN ('expense', 'cost_of_goods_sold')
             OR (type = 'asset' AND is_capitalizable))`,
    [tenantId, unique],
  )
  return new Set(rows.map((r) => r.code))
}

// Returns the band member row only if it belongs to the tenant. A member-paid
// purchase may be fronted by a band member profile that has no login account.
export async function validateBandMemberForTenant(executor, rawBandMemberId, tenantId) {
  const n = Number(rawBandMemberId)
  if (!Number.isInteger(n) || n <= 0) return null
  const { rows } = await executor.query(
    'SELECT id, user_id FROM band_members WHERE id = $1 AND tenant_id = $2',
    [n, tenantId],
  )
  return rows[0] || null
}

export async function replacePurchaseLines(executor, purchaseId, tenantId, lines) {
  await executor.query(
    'DELETE FROM purchase_lines WHERE purchase_id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  await insertPurchaseLines(executor, purchaseId, tenantId, lines)
}

// Returns the subset of `ids` that exist as non-archived products of the
// tenant. The line's composite FK is the backstop; this gives a clean 400 for
// cross-tenant or archived products before any insert is attempted.
export async function fetchValidProductIds(executor, tenantId, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Set()
  const { rows } = await executor.query(
    `SELECT id FROM products
      WHERE tenant_id = $1 AND id = ANY($2) AND archived_at IS NULL`,
    [tenantId, unique],
  )
  return new Set(rows.map((r) => r.id))
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

// List rows for the table/search. Includes the first line's description (the
// per-line description lives in purchase_lines, not on the purchase row).
// `periodSql`/`periodValues` come from buildPeriodWhere (placeholders $2+).
export async function listPurchases(executor, tenantId, periodSql, periodValues) {
  const { rows } = await executor.query(
    `SELECT p.id, p.receipt_number, p.supplier_name, p.supplier_contact_id,
            p.receipt_date, p.due_date, p.currency, p.status,
            p.subtotal_cents, p.tax_cents, p.total_cents,
            p.finalized_at, p.paid_at, p.created_at, p.updated_at,
            p.payment_method, p.paid_by_band_member_id,
            fl.description
       FROM purchases p
       LEFT JOIN LATERAL (
         SELECT description FROM purchase_lines pl
          WHERE pl.purchase_id = p.id AND pl.tenant_id = p.tenant_id
          ORDER BY position ASC, id ASC
          LIMIT 1
       ) fl ON TRUE
      WHERE p.tenant_id = $1
        ${periodSql}
      ORDER BY p.receipt_date DESC, p.id DESC`,
    [tenantId, ...periodValues],
  )
  return rows
}

export async function listPurchasePeriods(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT DISTINCT to_char(receipt_date, 'YYYY-MM-DD') AS date
       FROM purchases
      WHERE tenant_id = $1
        AND receipt_date IS NOT NULL
      ORDER BY date DESC`,
    [tenantId],
  )
  return rows.map((row) => row.date)
}

export async function fetchPurchaseAttachments(executor, purchaseId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, object_key, original_filename, content_type, file_size, uploaded_at
       FROM purchase_attachments
      WHERE purchase_id = $1 AND tenant_id = $2
      ORDER BY uploaded_at ASC, id ASC`,
    [purchaseId, tenantId],
  )
  return rows
}

export async function getPurchaseStatus(executor, purchaseId, tenantId) {
  const { rows } = await executor.query(
    'SELECT status FROM purchases WHERE id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  return rows[0]?.status ?? null
}

export async function deletePurchase(executor, purchaseId, tenantId) {
  await executor.query('DELETE FROM purchases WHERE id = $1 AND tenant_id = $2', [purchaseId, tenantId])
}

export async function deleteAttachmentReturningKey(executor, attachmentId, purchaseId, tenantId) {
  const { rows } = await executor.query(
    'DELETE FROM purchase_attachments WHERE id = $1 AND purchase_id = $2 AND tenant_id = $3 RETURNING object_key',
    [attachmentId, purchaseId, tenantId],
  )
  return rows[0]?.object_key ?? null
}
