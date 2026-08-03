export async function findOrderFinancial(executor, tenantId, orderId) {
  const { rows } = await executor.query(
    `SELECT * FROM shopify_order_financials
      WHERE tenant_id = $1
        AND (shopify_order_gid = $2 OR shopify_order_legacy_id = $2)`,
    [tenantId, String(orderId)],
  )
  return rows[0] ?? null
}

export async function insertOrderFinancial(executor, tenantId, order, actorUserId) {
  const { rows } = await executor.query(
    `INSERT INTO shopify_order_financials (
       tenant_id, shopify_order_gid, shopify_order_legacy_id, order_name,
       currency, gross_cents, fee_cents, net_cents, payment_gateway, processed_at,
       imported_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      tenantId, order.gid, order.id, order.name, order.currency,
      order.payment.amount_cents, order.payment.fee_cents, order.payment.net_cents,
      order.payment.payment_gateway, order.processed_at,
      actorUserId ?? null,
    ],
  )
  return rows[0]
}

export async function insertOrderComponent(executor, tenantId, financialId, component) {
  const { rows } = await executor.query(
    `INSERT INTO shopify_order_components (
       tenant_id, order_financial_id, component_key, component_kind, title,
       shopify_line_gid, shopify_line_legacy_id, mapping_kind, product_id,
       revenue_account_code, vat_rate, tax_category_code, tax_jurisdiction_code,
       quantity, gross_cents, net_revenue_cents, tax_cents, unit_cost_cents,
       merch_sale_id, ledger_transaction_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      tenantId, financialId, component.key, component.kind, component.title,
      component.gid ?? null, component.legacy_id ?? null, component.mapping_kind,
      component.product_id ?? null, component.revenue_account_code ?? null,
      component.vat_rate ?? 0, component.tax_category_code ?? null,
      component.tax_jurisdiction_code ?? null, component.quantity ?? 1,
      component.gross_cents, component.net_revenue_cents, component.tax_cents,
      component.unit_cost_cents ?? 0, component.merch_sale_id ?? null,
      component.ledger_transaction_id ?? null,
    ],
  )
  return rows[0]
}

export async function listOrderComponents(executor, tenantId, financialId) {
  const { rows } = await executor.query(
    `SELECT * FROM shopify_order_components
      WHERE tenant_id = $1 AND order_financial_id = $2 ORDER BY id`,
    [tenantId, financialId],
  )
  return rows
}

export async function upsertPayout(executor, tenantId, payout, syncComplete = false) {
  const { rows } = await executor.query(
    `INSERT INTO shopify_payments_payouts (
       tenant_id, shopify_payout_gid, shopify_payout_legacy_id, status,
       transaction_type, currency, net_cents, issued_at, external_trace_id, sync_complete
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id, shopify_payout_gid) DO UPDATE SET
       shopify_payout_legacy_id = EXCLUDED.shopify_payout_legacy_id,
       status = EXCLUDED.status,
       transaction_type = EXCLUDED.transaction_type,
       currency = EXCLUDED.currency,
       net_cents = EXCLUDED.net_cents,
       issued_at = EXCLUDED.issued_at,
       external_trace_id = EXCLUDED.external_trace_id,
       sync_complete = EXCLUDED.sync_complete,
       synced_at = NOW()
     RETURNING *`,
    [
      tenantId, payout.gid, payout.legacy_id, payout.status, payout.transaction_type,
      payout.currency, payout.net_cents, payout.issued_at, payout.external_trace_id ?? null,
      syncComplete,
    ],
  )
  return rows[0]
}

export async function insertCustomPayout(executor, tenantId, payout) {
  const { rows } = await executor.query(
    `INSERT INTO shopify_payments_payouts (
       tenant_id, shopify_payout_gid, shopify_payout_legacy_id, status,
       transaction_type, currency, net_cents, issued_at, external_trace_id,
       sync_complete, origin
     ) VALUES ($1,$2,$3,'PAID','DEPOSIT',$4,$5,$6,$7,TRUE,'custom')
     RETURNING *`,
    [
      tenantId, payout.gid, payout.legacyId, payout.currency,
      payout.netCents, payout.issuedAt, payout.reference,
    ],
  )
  return rows[0]
}

export async function setPayoutSyncComplete(executor, tenantId, payoutId, complete) {
  await executor.query(
    `UPDATE shopify_payments_payouts SET sync_complete = $1, synced_at = NOW()
      WHERE id = $2 AND tenant_id = $3`,
    [complete, payoutId, tenantId],
  )
}

export async function upsertBalanceTransaction(executor, tenantId, tx, {
  payoutId = null, orderFinancialId = null, initialStatus = 'pending',
} = {}) {
  const { rows } = await executor.query(
    `INSERT INTO shopify_payments_balance_transactions (
       tenant_id, shopify_balance_transaction_gid, order_financial_id,
       associated_order_gid, source_order_transaction_id, shopify_payout_gid,
       payout_id, source_type, transaction_type, transaction_date, currency,
       amount_cents, fee_cents, net_cents, is_test, processing_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (tenant_id, shopify_balance_transaction_gid) DO UPDATE SET
       order_financial_id = COALESCE(
         shopify_payments_balance_transactions.order_financial_id,
         EXCLUDED.order_financial_id
       ),
       associated_order_gid = EXCLUDED.associated_order_gid,
       source_order_transaction_id = EXCLUDED.source_order_transaction_id,
       shopify_payout_gid = EXCLUDED.shopify_payout_gid,
       payout_id = COALESCE(shopify_payments_balance_transactions.payout_id, EXCLUDED.payout_id),
       source_type = EXCLUDED.source_type,
       transaction_type = EXCLUDED.transaction_type,
       transaction_date = EXCLUDED.transaction_date,
       currency = EXCLUDED.currency,
       amount_cents = EXCLUDED.amount_cents,
       fee_cents = EXCLUDED.fee_cents,
       net_cents = EXCLUDED.net_cents,
       is_test = EXCLUDED.is_test,
       updated_at = NOW()
     RETURNING *`,
    [
      tenantId, tx.id, orderFinancialId, tx.associated_order_gid ?? null,
      tx.source_order_transaction_id ?? null, tx.payout_gid ?? null, payoutId,
      tx.source_type ?? null, tx.type, tx.transaction_date, tx.currency,
      tx.amount_cents, tx.fee_cents, tx.net_cents, tx.test,
      initialStatus,
    ],
  )
  return rows[0]
}

export async function listCustomPayoutCandidates(executor, tenantId, limit = 100) {
  const { rows } = await executor.query(
    `SELECT sof.id AS order_financial_id, sof.order_name,
            sof.shopify_order_legacy_id, sof.processed_at,
            bt.shopify_payout_gid, bt.currency,
            ARRAY_AGG(bt.id ORDER BY bt.transaction_date, bt.id) AS balance_transaction_ids,
            SUM(bt.net_cents)::int AS net_cents
       FROM shopify_payments_balance_transactions bt
       JOIN shopify_order_financials sof
         ON sof.id = bt.order_financial_id AND sof.tenant_id = bt.tenant_id
      WHERE bt.tenant_id = $1
        AND bt.payout_id IS NULL
        AND bt.processing_status = 'recorded'
        AND sof.payment_gateway = 'shopify_payments'
        AND NOT EXISTS (
          SELECT 1
            FROM shopify_payments_payouts spp
           WHERE spp.tenant_id = bt.tenant_id
             AND spp.shopify_payout_gid = bt.shopify_payout_gid
        )
      GROUP BY sof.id, sof.order_name, sof.shopify_order_legacy_id,
               sof.processed_at, bt.shopify_payout_gid, bt.currency
      ORDER BY sof.processed_at, sof.id
      LIMIT $2`,
    [tenantId, limit],
  )
  return rows
}

export async function lockCustomPayoutTransactions(executor, tenantId, ids) {
  if (!ids.length) return []
  const { rows } = await executor.query(
    `SELECT bt.*
       FROM shopify_payments_balance_transactions bt
       JOIN shopify_order_financials sof
         ON sof.id = bt.order_financial_id AND sof.tenant_id = bt.tenant_id
      WHERE bt.tenant_id = $1
        AND bt.id = ANY($2::int[])
        AND bt.payout_id IS NULL
        AND bt.processing_status = 'recorded'
        AND sof.payment_gateway = 'shopify_payments'
      ORDER BY bt.id
      FOR UPDATE OF bt`,
    [tenantId, ids],
  )
  return rows
}

export async function assignBalanceTransactionsToPayout(
  executor, tenantId, ids, payoutId,
) {
  const { rowCount } = await executor.query(
    `UPDATE shopify_payments_balance_transactions
        SET payout_id = $1, updated_at = NOW()
      WHERE tenant_id = $2 AND id = ANY($3::int[]) AND payout_id IS NULL`,
    [payoutId, tenantId, ids],
  )
  return rowCount
}

export async function markBalanceTransaction(executor, tenantId, id, {
  status, accountCode = null, ledgerTransactionId = null, orderFinancialId = null,
}) {
  await executor.query(
    `UPDATE shopify_payments_balance_transactions
        SET processing_status = $1, mapped_account_code = $2,
            ledger_transaction_id = $3,
            order_financial_id = COALESCE($4, order_financial_id), updated_at = NOW()
      WHERE id = $5 AND tenant_id = $6`,
    [status, accountCode, ledgerTransactionId, orderFinancialId, id, tenantId],
  )
}

export async function lockBalanceTransactionsForPayout(executor, tenantId, payoutId) {
  const { rows } = await executor.query(
    `SELECT * FROM shopify_payments_balance_transactions
      WHERE tenant_id = $1 AND payout_id = $2
      ORDER BY transaction_date, id FOR UPDATE`,
    [tenantId, payoutId],
  )
  return rows
}

export async function listBalanceTransactionsForPayouts(executor, tenantId, payoutIds) {
  if (!payoutIds.length) return []
  const { rows } = await executor.query(
    `SELECT bt.*, sof.shopify_order_legacy_id, sof.order_name
       FROM shopify_payments_balance_transactions bt
       LEFT JOIN shopify_order_financials sof
         ON sof.id = bt.order_financial_id AND sof.tenant_id = bt.tenant_id
      WHERE bt.tenant_id = $1 AND bt.payout_id = ANY($2::int[])
      ORDER BY bt.payout_id, bt.transaction_date, bt.id`,
    [tenantId, payoutIds],
  )
  return rows
}

export async function listPayoutCandidates(executor, tenantId, amounts, fromDate, toDate) {
  if (!amounts.length) return []
  const { rows } = await executor.query(
    `SELECT spp.*,
            COUNT(bt.id)::int AS balance_transaction_count,
            COUNT(bt.id) FILTER (
              WHERE bt.order_financial_id IS NULL AND bt.processing_status <> 'recorded'
            )::int AS unresolved_count,
            COALESCE(SUM(bt.net_cents), 0)::int AS balance_net_cents,
            COALESCE(BOOL_AND(bt.processing_status IN ('recorded','needs_review')), FALSE) AS covered
       FROM shopify_payments_payouts spp
       LEFT JOIN shopify_payments_balance_transactions bt
         ON bt.payout_id = spp.id AND bt.tenant_id = spp.tenant_id
      WHERE spp.tenant_id = $1
        AND ABS(spp.net_cents) = ANY($2::int[])
        AND spp.issued_at::date BETWEEN $3::date AND $4::date
        AND spp.status = 'PAID'
        AND spp.reconciled_bank_statement_line_id IS NULL
        AND spp.ledger_transaction_id IS NULL
      GROUP BY spp.id
      ORDER BY spp.issued_at DESC`,
    [tenantId, amounts, fromDate, toDate],
  )
  return rows
}

export async function listManuallySettledPayouts(
  executor, tenantId, amounts, fromDate, toDate,
) {
  if (!amounts.length) return []
  const { rows } = await executor.query(
    `SELECT *
       FROM shopify_payments_payouts
      WHERE tenant_id = $1
        AND ABS(net_cents) = ANY($2::int[])
        AND settlement_method = 'manual'
        AND settlement_entry_date BETWEEN $3::date AND $4::date
        AND ledger_transaction_id IS NOT NULL
      ORDER BY settlement_entry_date, id`,
    [tenantId, amounts, fromDate, toDate],
  )
  return rows
}

export async function getPayout(executor, tenantId, payoutId) {
  const { rows } = await executor.query(
    `SELECT * FROM shopify_payments_payouts WHERE id = $1 AND tenant_id = $2`,
    [payoutId, tenantId],
  )
  return rows[0] ?? null
}

export async function lockPayout(executor, tenantId, payoutId) {
  const { rows } = await executor.query(
    `SELECT * FROM shopify_payments_payouts
      WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [payoutId, tenantId],
  )
  return rows[0] ?? null
}

export async function markPayoutReconciled(executor, tenantId, payoutId, lineId, ledgerTransactionId) {
  await executor.query(
    `UPDATE shopify_payments_payouts
        SET reconciled_bank_statement_line_id = $1, ledger_transaction_id = $2,
            settlement_method = 'bank_import',
            settlement_entry_date = (
              SELECT booking_date FROM bank_statement_lines
               WHERE id = $1 AND tenant_id = $4
            ),
            settled_at = NOW()
      WHERE id = $3 AND tenant_id = $4`,
    [lineId, ledgerTransactionId, payoutId, tenantId],
  )
}

export async function listManualPayoutCandidates(executor, tenantId, limit = 100) {
  const { rows } = await executor.query(
    `SELECT spp.*,
            COUNT(bt.id)::int AS balance_transaction_count,
            COALESCE(SUM(bt.net_cents), 0)::int AS balance_net_cents,
            COALESCE(BOOL_AND(bt.processing_status IN ('recorded','needs_review')), FALSE) AS covered
       FROM shopify_payments_payouts spp
       LEFT JOIN shopify_payments_balance_transactions bt
         ON bt.payout_id = spp.id AND bt.tenant_id = spp.tenant_id
      WHERE spp.tenant_id = $1
        AND spp.status = 'PAID'
        AND spp.reconciled_bank_statement_line_id IS NULL
        AND spp.ledger_transaction_id IS NULL
      GROUP BY spp.id
      ORDER BY spp.issued_at DESC, spp.id DESC
      LIMIT $2`,
    [tenantId, limit],
  )
  return rows
}

export async function markPayoutManuallySettled(
  executor, tenantId, payoutId, entryDate, ledgerTransactionId, actorUserId,
) {
  const { rows } = await executor.query(
    `UPDATE shopify_payments_payouts
        SET ledger_transaction_id = $1, settlement_method = 'manual',
            settlement_entry_date = $2, settled_at = NOW(), settled_by_user_id = $3
      WHERE id = $4 AND tenant_id = $5
      RETURNING *`,
    [ledgerTransactionId, entryDate, actorUserId ?? null, payoutId, tenantId],
  )
  return rows[0] ?? null
}

export async function insertComponentAdjustment(executor, tenantId, componentId, balanceTransactionId, adjustment) {
  const { rows } = await executor.query(
    `INSERT INTO shopify_order_component_adjustments (
       tenant_id, component_id, balance_transaction_id, shopify_refund_gid,
       quantity, gross_cents, net_revenue_cents, tax_cents, restocked,
       ledger_transaction_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id, component_id, balance_transaction_id) DO NOTHING
     RETURNING *`,
    [
      tenantId, componentId, balanceTransactionId, adjustment.refund_gid ?? null,
      adjustment.quantity ?? 0, adjustment.gross_cents, adjustment.net_revenue_cents,
      adjustment.tax_cents, adjustment.restocked ?? false,
      adjustment.ledger_transaction_id ?? null,
    ],
  )
  return rows[0] ?? null
}

export async function listUnreconciledPaypalOrders(executor, tenantId, fromDate, toDate) {
  const { rows } = await executor.query(
    `SELECT sof.id, sof.order_name, sof.currency, sof.gross_cents,
            sof.shopify_order_legacy_id, sof.processed_at
       FROM shopify_order_financials sof
      WHERE sof.tenant_id = $1
        AND sof.payment_gateway = 'paypal'
        AND sof.processed_at::date BETWEEN $2::date AND $3::date
        AND NOT EXISTS (
          SELECT 1 FROM paypal_payout_reconciliation_orders ppro
           WHERE ppro.tenant_id = sof.tenant_id
             AND ppro.order_financial_id = sof.id
        )
      ORDER BY sof.processed_at, sof.id
      LIMIT 500`,
    [tenantId, fromDate, toDate],
  )
  return rows
}

export async function listManualPaypalPayoutCandidates(executor, tenantId, limit = 100) {
  const { rows } = await executor.query(
    `SELECT sof.id, sof.order_name, sof.currency, sof.gross_cents,
            sof.shopify_order_legacy_id, sof.processed_at
       FROM shopify_order_financials sof
      WHERE sof.tenant_id = $1
        AND sof.payment_gateway = 'paypal'
        AND NOT EXISTS (
          SELECT 1 FROM paypal_payout_reconciliation_orders ppro
           WHERE ppro.tenant_id = sof.tenant_id
             AND ppro.order_financial_id = sof.id
        )
      ORDER BY sof.processed_at, sof.id
      LIMIT $2`,
    [tenantId, limit],
  )
  return rows
}

export async function listManuallySettledPaypalPayouts(
  executor, tenantId, amounts, fromDate, toDate,
) {
  if (!amounts.length) return []
  const { rows } = await executor.query(
    `SELECT *
       FROM paypal_payout_reconciliations
      WHERE tenant_id = $1
        AND deposit_cents = ANY($2::int[])
        AND settlement_method = 'manual'
        AND settlement_entry_date BETWEEN $3::date AND $4::date
        AND ledger_transaction_id IS NOT NULL
      ORDER BY settlement_entry_date, id`,
    [tenantId, amounts, fromDate, toDate],
  )
  return rows
}

export async function lockUnreconciledPaypalOrders(executor, tenantId, orderIds) {
  if (!orderIds.length) return []
  const { rows } = await executor.query(
    `SELECT sof.*
       FROM shopify_order_financials sof
      WHERE sof.tenant_id = $1
        AND sof.id = ANY($2::int[])
        AND sof.payment_gateway = 'paypal'
        AND NOT EXISTS (
          SELECT 1 FROM paypal_payout_reconciliation_orders ppro
           WHERE ppro.tenant_id = sof.tenant_id
             AND ppro.order_financial_id = sof.id
        )
      ORDER BY sof.id
      FOR UPDATE OF sof`,
    [tenantId, orderIds],
  )
  return rows
}

export async function insertPaypalPayoutReconciliation(executor, tenantId, data) {
  const { rows } = await executor.query(
    `INSERT INTO paypal_payout_reconciliations (
       tenant_id, bank_statement_line_id, currency, gross_cents, deposit_cents,
       difference_cents, difference_account_code, reference, created_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      tenantId, data.bankStatementLineId ?? null, data.currency, data.grossCents,
      data.depositCents, data.differenceCents, data.differenceAccountCode ?? null,
      data.reference ?? null, data.actorUserId ?? null,
    ],
  )
  return rows[0]
}

export async function linkPaypalReconciliationOrders(
  executor, tenantId, reconciliationId, orderIds,
) {
  await executor.query(
    `INSERT INTO paypal_payout_reconciliation_orders (
       reconciliation_id, order_financial_id, tenant_id
     )
     SELECT $1, unnest($2::int[]), $3`,
    [reconciliationId, orderIds, tenantId],
  )
}

export async function markPaypalReconciliationPosted(
  executor, tenantId, reconciliationId, data,
) {
  const { rows } = await executor.query(
    `UPDATE paypal_payout_reconciliations
        SET ledger_transaction_id = $1, settlement_method = $2,
            settlement_entry_date = $3, settled_at = NOW(), settled_by_user_id = $4
      WHERE id = $5 AND tenant_id = $6
      RETURNING *`,
    [
      data.ledgerTransactionId, data.settlementMethod, data.entryDate,
      data.actorUserId ?? null, reconciliationId, tenantId,
    ],
  )
  return rows[0] ?? null
}
