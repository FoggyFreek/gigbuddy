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

export async function listFinanciallyImportedOrderIds(executor, tenantId, orderIds) {
  if (!orderIds.length) return new Set()
  const { rows } = await executor.query(
    `SELECT shopify_order_legacy_id FROM shopify_order_financials
      WHERE tenant_id = $1 AND shopify_order_legacy_id = ANY($2::text[])`,
    [tenantId, orderIds.map(String)],
  )
  return new Set(rows.map((r) => r.shopify_order_legacy_id))
}

export async function insertImport(executor, tenantId, {
  shopifyOrderId, shopifyLineId, kind, merchSaleId = null, ledgerTransactionId = null,
  createdByUserId = null, orderFinancialId = null,
}) {
  const { rows } = await executor.query(
    `INSERT INTO shopify_order_imports
       (tenant_id, shopify_order_id, shopify_line_id, kind, merch_sale_id,
        ledger_transaction_id, created_by_user_id, shopify_order_financial_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [tenantId, String(shopifyOrderId), String(shopifyLineId), kind, merchSaleId,
      ledgerTransactionId, createdByUserId, orderFinancialId],
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
