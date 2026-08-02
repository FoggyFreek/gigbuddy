import { fetchOrdersByIds } from './shopifyService.js'
import { computeLineGrossInclCents, currentQuantity } from './shopifyImportMapping.js'
import { recordMerchSaleTx } from './merchService.js'
import {
  ledgerErrorResult,
  postShopifyRevenueLine,
  postShopifyPaymentFee,
} from './ledgerService.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { accountExistsOfType } from '../repositories/accountRepository.js'
import { getSaleImportSnapshot, lockProduct } from '../repositories/merchRepository.js'
import {
  insertImport,
  setImportLedgerTransaction,
} from '../repositories/shopifyImportRepository.js'
import {
  findOrderFinancial,
  insertOrderFinancial,
  insertOrderComponent,
  upsertBalanceTransaction,
  markBalanceTransaction,
} from '../repositories/shopifyPaymentsRepository.js'
import { getSettings } from './accountService.js'
import { isKnownVatRate } from '../../shared/vatRates.js'

function toDateString(value) {
  return String(value || new Date().toISOString()).slice(0, 10)
}

function componentTotals(grossCents, vatRate) {
  const rate = Number(vatRate || 0)
  const netRevenueCents = rate > 0
    ? Math.round((grossCents * 100) / (100 + rate))
    : grossCents
  return { netRevenueCents, taxCents: grossCents - netRevenueCents }
}

function selectionMaps(selected) {
  return {
    lines: new Map((selected.lines ?? []).map((line) => [String(line.shopify_line_id), line.mapping])),
    extras: new Map((selected.extra_components ?? []).map((extra) => [String(extra.component_key), extra.mapping])),
  }
}

function validateMapping(mapping, allowProduct) {
  if (!mapping || mapping.type === 'skip') return false
  if (mapping.type === 'product') return allowProduct && Number.isInteger(Number(mapping.product_id))
  return mapping.type === 'revenue'
    && Boolean(String(mapping.account_code ?? '').trim())
    && isKnownVatRate(Number(mapping.vat_rate ?? 0))
}

function validateCompleteSelection(order, selected) {
  const maps = selectionMaps(selected)
  const liveLines = order.line_items.filter((line) => currentQuantity(line) > 0)
  if (liveLines.some((line) => !validateMapping(maps.lines.get(line.id), true))) return null
  if (order.extra_components.some((extra) => !validateMapping(maps.extras.get(extra.key), false))) return null
  return maps
}

async function importProductComponent(
  client, tenantId, financial, order, line, mapping, actorUserId, clearing, defaultRevenue,
) {
  const quantity = currentQuantity(line)
  const product = await lockProduct(client, tenantId, Number(mapping.product_id))
  if (!product || product.archived_at) abortTransaction('skipped_invalid_mapping')
  const grossCents = computeLineGrossInclCents(order, line, Number(product.vat_rate))
  const result = await recordMerchSaleTx(client, tenantId, {
    product_id: Number(mapping.product_id),
    quantity,
    unit_price_incl_cents: Math.round(grossCents / quantity),
    gross_incl_cents: grossCents,
    vat_rate: Number(product.vat_rate),
    payment_method: 'bank',
    sale_date: toDateString(order.created_at),
  }, { actorUserId, receiptAccountCode: clearing })
  if (result.error) {
    if (result.error.body?.code === 'insufficient_stock') abortTransaction('skipped_insufficient_stock')
    abortTransaction('skipped_invalid_mapping')
  }
  const sale = await getSaleImportSnapshot(client, tenantId, result.saleId)
  const actualGross = sale.gross_incl_cents ?? sale.quantity * sale.unit_price_incl_cents
  const totals = componentTotals(actualGross, sale.vat_rate)
  await insertImport(client, tenantId, {
    shopifyOrderId: order.id,
    shopifyLineId: line.id,
    kind: 'product',
    merchSaleId: result.saleId,
    createdByUserId: actorUserId,
    orderFinancialId: financial.id,
  })
  await insertOrderComponent(client, tenantId, financial.id, {
    key: line.id,
    kind: 'line',
    title: line.title,
    gid: line.gid,
    legacy_id: line.id,
    mapping_kind: 'product',
    product_id: Number(mapping.product_id),
    revenue_account_code: sale.revenue_account_code || defaultRevenue,
    vat_rate: Number(sale.vat_rate),
    quantity,
    gross_cents: actualGross,
    net_revenue_cents: totals.netRevenueCents,
    tax_cents: totals.taxCents,
    unit_cost_cents: sale.unit_cost_cents,
    merch_sale_id: result.saleId,
    ledger_transaction_id: result.ledgerTransactionId,
  })
  return actualGross
}

async function importRevenueComponent(client, tenantId, financial, order, component, mapping, actorUserId, clearing) {
  const accountCode = String(mapping.account_code).trim()
  if (!(await accountExistsOfType(client, tenantId, accountCode, 'revenue'))) {
    abortTransaction('skipped_invalid_account')
  }
  const vatRate = Number(mapping.vat_rate ?? 0)
  const grossCents = component.gross_cents
  const imp = await insertImport(client, tenantId, {
    shopifyOrderId: order.id,
    shopifyLineId: component.key,
    kind: 'revenue',
    createdByUserId: actorUserId,
    orderFinancialId: financial.id,
  })
  const posted = await postShopifyRevenueLine(client, tenantId, {
    id: imp.id,
    entry_date: toDateString(order.created_at),
    amount_incl_cents: grossCents,
    vat_rate: vatRate,
    tax_category_code: mapping.tax_category_code ?? null,
    tax_jurisdiction_code: mapping.tax_jurisdiction_code ?? null,
    revenue_account_code: accountCode,
    memo: `Shopify ${order.name}: ${component.title}`,
  }, { actorUserId, receiptAccountCode: clearing })
  if (posted.posted && posted.transactionId) {
    await setImportLedgerTransaction(client, tenantId, imp.id, posted.transactionId)
  }
  const totals = componentTotals(grossCents, vatRate)
  await insertOrderComponent(client, tenantId, financial.id, {
    key: component.key,
    kind: component.kind,
    title: component.title,
    gid: component.gid,
    legacy_id: component.legacy_id,
    mapping_kind: 'revenue',
    revenue_account_code: accountCode,
    vat_rate: vatRate,
    tax_category_code: mapping.tax_category_code ?? null,
    tax_jurisdiction_code: mapping.tax_jurisdiction_code ?? null,
    quantity: component.quantity ?? 1,
    gross_cents: grossCents,
    net_revenue_cents: totals.netRevenueCents,
    tax_cents: totals.taxCents,
    ledger_transaction_id: posted.transactionId ?? null,
  })
  return grossCents
}

function revenueLineComponent(order, line, mapping) {
  return {
    key: line.id,
    kind: 'line',
    title: line.title,
    gid: line.gid,
    legacy_id: line.id,
    quantity: currentQuantity(line),
    gross_cents: computeLineGrossInclCents(order, line, Number(mapping.vat_rate ?? 0)),
  }
}

function extraComponent(order, extra, mapping) {
  const base = extra.amount_cents
  const rate = Number(mapping.vat_rate ?? 0)
  const gross = order.taxes_included ? base : base + Math.round((base * rate) / 100)
  return { ...extra, gross_cents: gross, quantity: 1 }
}

async function persistPaymentTransactions(client, tenantId, financial, order, actorUserId) {
  for (const remote of order.payment.transactions) {
    const tx = await upsertBalanceTransaction(client, tenantId, remote, {
      orderFinancialId: financial.id,
      initialStatus: 'recorded',
    })
    const posted = await postShopifyPaymentFee(client, tenantId, {
      id: tx.id,
      remoteId: remote.id,
      feeCents: remote.fee_cents,
      transactionDate: remote.transaction_date,
    }, { actorUserId })
    await markBalanceTransaction(client, tenantId, tx.id, {
      status: 'recorded',
      ledgerTransactionId: posted.transactionId ?? null,
      orderFinancialId: financial.id,
    })
  }
}

async function importOrder(db, tenantId, order, selected, actorUserId) {
  if (order.skip_reason) return order.skip_reason
  const maps = validateCompleteSelection(order, selected)
  if (!maps) return 'skipped_incomplete_mapping'
  return withTransaction(async (client) => {
    if (await findOrderFinancial(client, tenantId, order.id)) abortTransaction('skipped_duplicate')
    const { settings } = await getSettings(client, tenantId)
    const isPaypal = order.payment.payment_gateway === 'paypal'
    const clearing = isPaypal
      ? settings.paypal_clearing_account_code
      : settings.shopify_clearing_account_code
    if (!clearing || (!isPaypal && !settings.shopify_fee_expense_account_code)) {
      abortTransaction('skipped_accounting_not_configured')
    }
    const financial = await insertOrderFinancial(client, tenantId, order, actorUserId)
    let componentGross = 0
    for (const line of order.line_items.filter((item) => currentQuantity(item) > 0)) {
      const mapping = maps.lines.get(line.id)
      componentGross += mapping.type === 'product'
        ? await importProductComponent(
          client, tenantId, financial, order, line, mapping, actorUserId,
          clearing, settings.merch_revenue_account_code,
        )
        : await importRevenueComponent(
          client, tenantId, financial, order,
          revenueLineComponent(order, line, mapping), mapping, actorUserId, clearing,
        )
    }
    for (const extra of order.extra_components) {
      const mapping = maps.extras.get(extra.key)
      componentGross += await importRevenueComponent(
        client, tenantId, financial, order,
        extraComponent(order, extra, mapping), mapping, actorUserId, clearing,
      )
    }
    if (componentGross !== order.payment.amount_cents) abortTransaction('skipped_order_total_mismatch')
    if (!isPaypal) {
      await persistPaymentTransactions(client, tenantId, financial, order, actorUserId)
    }
    return 'imported'
  }, {
    db,
    mapError: (err) => {
      if (err.code === '23505') return 'skipped_duplicate'
      const mapped = ledgerErrorResult(err)
      if (mapped?.error.body.code === 'period_closed') return 'skipped_closed_period'
      if (mapped?.error.body.code === 'accounting_not_configured') return 'skipped_accounting_not_configured'
      return null
    },
  })
}

export async function importShopifyOrders(db, tenantId, body, actorUserId = null, fetchImpl = globalThis.fetch) {
  const selections = Array.isArray(body?.orders) ? body.orders : null
  if (!selections) return { error: { status: 400, body: { error: 'orders must be an array' } } }
  const orderIds = selections.map((order) => order?.shopify_order_id).filter(Boolean)
  if (!orderIds.length) return { error: { status: 400, body: { error: 'No orders selected' } } }
  const fetched = await fetchOrdersByIds(db, tenantId, orderIds, fetchImpl)
  if (fetched.error) return fetched
  const byId = new Map(fetched.orders.map((order) => [order.id, order]))
  const results = []
  for (const selected of selections) {
    const orderId = String(selected.shopify_order_id)
    const order = byId.get(orderId)
    const status = order
      ? await importOrder(db, tenantId, order, selected, actorUserId)
      : 'skipped_not_found'
    results.push({
      shopify_order_id: orderId,
      status,
      fee_cents: order?.payment ? order.payment.fee_cents : null,
      net_cents: order?.payment ? order.payment.net_cents : null,
    })
  }
  const imported = results.filter((result) => result.status === 'imported').length
  return { imported, skipped: results.length - imported, results }
}
