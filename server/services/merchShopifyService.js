// Shopify order import → merch sales / revenue-only journals.
//
// The frontend submits only Shopify ids + per-line mapping decisions (no money).
// This service re-fetches the selected orders authoritatively from Shopify and
// recomputes every amount from the order's effective/current fields, so a client
// can't overstate revenue or stock. Each line is imported in its own transaction
// (report-and-skip: one failing line doesn't roll back the others) and is
// idempotent via the shopify_order_imports tracking table (UNIQUE per line).
import { fetchOrdersByIds } from './shopifyService.js'
import {
  orderSkipReason,
  lineSkipReason,
  computeLineGrossInclCents,
  currentQuantity,
} from './shopifyImportMapping.js'
import { recordMerchSaleTx } from './merchService.js'
import { ledgerErrorResult, postShopifyRevenueLine } from './ledgerService.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { accountExistsOfType } from '../repositories/accountRepository.js'
import {
  isLineImported,
  insertImport,
  setImportLedgerTransaction,
} from '../repositories/shopifyImportRepository.js'
import { ALLOWED_TAX_RATES } from '../validators/purchaseValidators.js'

const ALLOWED_TAX_RATES_SET = new Set(ALLOWED_TAX_RATES)

function parsePositiveInt(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function toDateString(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

// Records a product-mapped line as a merch sale (inventory + COGS). Returns a
// status string; never commits (caller owns the transaction).
async function importProductLine(client, tenantId, order, line, mapping, actorUserId) {
  const productId = parsePositiveInt(mapping.product_id)
  if (!productId) return 'skipped_invalid_mapping'

  // The product's VAT rate drives both the gross (for tax-exclusive stores) and
  // the ledger split, mirroring a manual sale.
  const { rows } = await client.query(
    'SELECT vat_rate FROM products WHERE id = $1 AND tenant_id = $2',
    [productId, tenantId],
  )
  if (!rows[0]) return 'skipped_invalid_mapping'
  const vatRate = Number(rows[0].vat_rate)

  const qty = currentQuantity(line)
  const grossInclCents = computeLineGrossInclCents(order, line, vatRate)

  const res = await recordMerchSaleTx(client, tenantId, {
    product_id: productId,
    quantity: qty,
    unit_price_incl_cents: Math.round(grossInclCents / qty),
    gross_incl_cents: grossInclCents,
    vat_rate: vatRate,
    payment_method: 'bank',
    sale_date: toDateString(order.created_at),
  }, { actorUserId })

  if (res.error) {
    if (res.error.body?.code === 'insufficient_stock') return 'skipped_insufficient_stock'
    return 'skipped_error'
  }

  await insertImport(client, tenantId, {
    shopifyOrderId: order.id,
    shopifyLineId: line.id,
    kind: 'product',
    merchSaleId: res.saleId,
    createdByUserId: actorUserId,
  })
  return 'imported'
}

// Records a line mapped to a tenant revenue account as a revenue-only journal
// (no inventory). The tracking row is inserted first so its id is the ledger
// source_id, then the resulting transaction id is backfilled.
async function importRevenueLine(client, tenantId, order, line, mapping, actorUserId) {
  const accountCode = String(mapping.account_code ?? '').trim()
  if (!accountCode) return 'skipped_invalid_mapping'
  const vatRate = Number(mapping.vat_rate ?? 0)
  if (!ALLOWED_TAX_RATES_SET.has(vatRate)) return 'skipped_invalid_mapping'

  if (!(await accountExistsOfType(client, tenantId, accountCode, 'revenue'))) {
    return 'skipped_invalid_account'
  }

  const grossInclCents = computeLineGrossInclCents(order, line, vatRate)
  if (grossInclCents <= 0) return 'skipped_refunded_line'

  const imp = await insertImport(client, tenantId, {
    shopifyOrderId: order.id,
    shopifyLineId: line.id,
    kind: 'revenue',
    createdByUserId: actorUserId,
  })
  const posted = await postShopifyRevenueLine(client, tenantId, {
    id: imp.id,
    entry_date: toDateString(order.created_at),
    amount_incl_cents: grossInclCents,
    vat_rate: vatRate,
    revenue_account_code: accountCode,
    memo: `Shopify ${order.name}: ${line.title}`,
  }, { actorUserId })
  if (posted.posted && posted.transactionId) {
    await setImportLedgerTransaction(client, tenantId, imp.id, posted.transactionId)
  }
  return 'imported'
}

// Imports one selected line in its own transaction. Maps ledger guard errors
// (closed period / unconfigured accounts) to a skip status so the rest of the
// import proceeds.
async function importLine(pool, tenantId, order, line, selLine, actorUserId) {
  if (!line) return 'skipped_not_found'
  const mapping = selLine.mapping || {}
  if (mapping.type === 'skip') return 'skipped'

  const lineSkip = lineSkipReason(line)
  if (lineSkip) return lineSkip

  return withTransaction(async (client) => {
    if (await isLineImported(client, tenantId, line.id)) {
      abortTransaction('skipped_duplicate')
    }

    let status
    if (mapping.type === 'product') {
      status = await importProductLine(client, tenantId, order, line, mapping, actorUserId)
    } else if (mapping.type === 'revenue') {
      status = await importRevenueLine(client, tenantId, order, line, mapping, actorUserId)
    } else {
      status = 'skipped_invalid_mapping'
    }

    // Not imported: roll back any partial work and report the skip status.
    if (status !== 'imported') abortTransaction(status)
    return 'imported'
  }, {
    db: pool,
    mapError: (err) => {
      const mapped = ledgerErrorResult(err)
      if (mapped?.error.body.code === 'period_closed') return 'skipped_closed_period'
      if (mapped?.error.body.code === 'accounting_not_configured') return 'skipped_accounting_not_configured'
      return null
    },
  })
}

export async function importShopifyOrders(pool, tenantId, body, actorUserId = null, fetchImpl = globalThis.fetch) {
  const orders = Array.isArray(body?.orders) ? body.orders : null
  if (!orders) return { error: { status: 400, body: { error: 'orders must be an array' } } }

  const orderIds = orders.map((o) => o?.shopify_order_id).filter(Boolean)
  if (!orderIds.length) return { error: { status: 400, body: { error: 'No orders selected' } } }

  // Authoritative re-fetch — amounts and eligibility come from Shopify, not the client.
  const fetched = await fetchOrdersByIds(pool, tenantId, orderIds, fetchImpl)
  if (fetched.error) return fetched
  const byId = new Map(fetched.orders.map((o) => [o.id, o]))

  const results = []
  for (const sel of orders) {
    const order = byId.get(String(sel.shopify_order_id))
    const selLines = Array.isArray(sel.lines) ? sel.lines : []
    if (!order) {
      for (const l of selLines) results.push({ shopify_line_id: String(l.shopify_line_id), status: 'skipped_not_found' })
      continue
    }
    const orderSkip = orderSkipReason(order)
    if (orderSkip) {
      for (const l of selLines) results.push({ shopify_line_id: String(l.shopify_line_id), status: orderSkip })
      continue
    }
    const lineById = new Map(order.line_items.map((l) => [l.id, l]))
    for (const selLine of selLines) {
      const line = lineById.get(String(selLine.shopify_line_id))
      const status = await importLine(pool, tenantId, order, line, selLine, actorUserId)
      results.push({ shopify_line_id: String(selLine.shopify_line_id), status })
    }
  }

  const imported = results.filter((r) => r.status === 'imported').length
  return { imported, skipped: results.length - imported, results }
}
