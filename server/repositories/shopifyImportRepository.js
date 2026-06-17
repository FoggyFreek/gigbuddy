// SQL for the shopify_order_imports tracking table (line-level import dedupe).
// Every function takes an executor (pool or transaction client) first and is
// tenant-scoped.

// Shopify line ids already imported for the given order ids. Returns a Set of
// shopify_line_id strings so the orders list can flag imported lines.
export async function listImportedLineIds(executor, tenantId, orderIds) {
  if (!orderIds.length) return new Set()
  const { rows } = await executor.query(
    `SELECT shopify_line_id FROM shopify_order_imports
      WHERE tenant_id = $1 AND shopify_order_id = ANY($2::text[])`,
    [tenantId, orderIds.map(String)],
  )
  return new Set(rows.map((r) => r.shopify_line_id))
}

// Whether a specific line was already imported (the dedupe gate at import time).
export async function isLineImported(executor, tenantId, lineId) {
  const { rows } = await executor.query(
    'SELECT 1 FROM shopify_order_imports WHERE tenant_id = $1 AND shopify_line_id = $2',
    [tenantId, String(lineId)],
  )
  return rows.length > 0
}

export async function insertImport(executor, tenantId, {
  shopifyOrderId, shopifyLineId, kind, merchSaleId = null, ledgerTransactionId = null, createdByUserId = null,
}) {
  const { rows } = await executor.query(
    `INSERT INTO shopify_order_imports
       (tenant_id, shopify_order_id, shopify_line_id, kind, merch_sale_id, ledger_transaction_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [tenantId, String(shopifyOrderId), String(shopifyLineId), kind, merchSaleId, ledgerTransactionId, createdByUserId],
  )
  return rows[0]
}

// A revenue line inserts its tracking row first (its id becomes the ledger
// source_id), posts the journal, then backfills the resulting transaction id.
export async function setImportLedgerTransaction(executor, tenantId, importId, ledgerTransactionId) {
  await executor.query(
    `UPDATE shopify_order_imports SET ledger_transaction_id = $1
      WHERE id = $2 AND tenant_id = $3`,
    [ledgerTransactionId, importId, tenantId],
  )
}
