import { randomUUID } from 'node:crypto'
import {
  shopifyGraphql,
  fetchBalanceTransactions,
  fetchOrdersByIds,
  legacyId,
  moneyToCents,
} from './shopifyService.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { getSettings } from '../../finance/accounts/accountService.js'
import {
  postShopifyPaymentFee,
  postShopifyPayoutAdjustment,
  postShopifyRefund,
  postShopifyPayoutSettlement,
  ledgerErrorResult,
} from '../../finance/ledger/ledgerService.js'
import {
  findOrderFinancial,
  listOrderComponents,
  upsertPayout,
  setPayoutSyncComplete,
  upsertBalanceTransaction,
  markBalanceTransaction,
  insertComponentAdjustment,
  getPayout,
  lockPayout,
  lockBalanceTransactionsForPayout,
  listManualPayoutCandidates,
  listBalanceTransactionsForPayouts,
  markPayoutManuallySettled,
  insertCustomPayout,
  listCustomPayoutCandidates,
  lockCustomPayoutTransactions,
  assignBalanceTransactionsToPayout,
} from './shopifyPaymentsRepository.js'
import { restoreProductStock } from './merchRepository.js'
import { accountExistsOfType } from '../../finance/accounts/accountRepository.js'
import {
  validateManualPayoutSettlement,
  validatePayoutRefresh,
  validateCustomPayout,
} from './shopifyPayoutValidators.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'
import { parseListLimit } from '../../validators/common.js'

const PAYOUT_QUERY = `#graphql
  query GigbuddyPayouts($first: Int!, $after: String, $query: String) {
    shopifyPaymentsAccount {
      payouts(
        first: $first, after: $after, query: $query,
        sortKey: ISSUED_AT, reverse: true
      ) {
        nodes {
          id legacyResourceId status transactionType issuedAt externalTraceId
          net { amount currencyCode }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`

function payoutDto(node) {
  return {
    gid: node.id,
    legacy_id: String(node.legacyResourceId),
    status: node.status,
    transaction_type: node.transactionType,
    issued_at: node.issuedAt,
    external_trace_id: node.externalTraceId ?? null,
    net_cents: moneyToCents(node.net.amount),
    currency: String(node.net.currencyCode).toUpperCase(),
  }
}

async function fetchPayouts(db, tenantId, fromDate, toDate, fetchImpl) {
  const payouts = []
  let after = null
  const search = `issued_at:>=${JSON.stringify(fromDate)} issued_at:<=${JSON.stringify(toDate)}`
  do {
    const result = await shopifyGraphql(db, tenantId, PAYOUT_QUERY, {
      first: 250, after, query: search,
    }, fetchImpl)
    if (result.error) return result
    const connection = result.data?.shopifyPaymentsAccount?.payouts
    if (!connection) return { error: { status: 400, body: { error: 'shopify_payments_unavailable' } } }
    payouts.push(...connection.nodes.map(payoutDto))
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
  } while (after)
  return { payouts }
}

function refundForTransaction(order, transactionId) {
  return (order.refunds ?? []).find((refund) => (
    (refund.transactions?.nodes ?? []).some((tx) => (
      legacyId(tx.id) === String(transactionId)
      && tx.status === 'SUCCESS'
    ))
  )) ?? null
}

function refundParts(refund, components, targetGross) {
  const byLineGid = new Map(components.filter((c) => c.shopify_line_gid).map((c) => [c.shopify_line_gid, c]))
  const parts = []
  let allocated = 0
  for (const item of refund.refundLineItems?.nodes ?? []) {
    const component = byLineGid.get(item.lineItem?.id)
    if (!component) return null
    const net = moneyToCents(item.subtotalSet?.shopMoney?.amount ?? 0)
    const tax = moneyToCents(item.totalTaxSet?.shopMoney?.amount ?? 0)
    const gross = net + tax
    if (gross <= 0) continue
    parts.push({
      component,
      quantity: Number(item.quantity) || 0,
      grossCents: gross,
      netRevenueCents: net,
      taxCents: tax,
      restocked: Boolean(item.restocked) && item.restockType !== 'NO_RESTOCK',
    })
    allocated += gross
  }
  let residual = targetGross - allocated
  if (residual < 0) return null
  if (residual > 0) {
    const extra = components.find((c) => c.component_kind !== 'line')
    if (!extra) return null
    const rate = Number(extra.vat_rate || 0)
    const net = rate > 0 ? Math.round((residual * 100) / (100 + rate)) : residual
    parts.push({
      component: extra,
      quantity: 0,
      grossCents: residual,
      netRevenueCents: net,
      taxCents: residual - net,
      restocked: false,
    })
    residual = 0
  }
  return residual === 0 ? parts : null
}

async function processRefund(db, tenantId, balanceRow, orderFinancial, remoteOrder, actorUserId) {
  const refund = refundForTransaction(remoteOrder, balanceRow.source_order_transaction_id)
  const components = await listOrderComponents(db, tenantId, orderFinancial.id)
  const targetGross = Math.abs(balanceRow.amount_cents)
  const parts = refund ? refundParts(refund, components, targetGross) : null
  if (!refund || !parts?.length) {
    await markBalanceTransaction(db, tenantId, balanceRow.id, { status: 'blocked' })
    return false
  }
  return withTransaction(async (client) => {
    const posted = await postShopifyRefund(client, tenantId, {
      id: balanceRow.id,
      remoteId: balanceRow.shopify_balance_transaction_gid,
      transactionDate: balanceRow.transaction_date,
      grossCents: targetGross,
      components: parts.map((part) => ({
        id: part.component.id,
        ledgerTransactionId: part.component.ledger_transaction_id,
        revenueAccountCode: part.component.revenue_account_code,
        grossCents: part.grossCents,
        netRevenueCents: part.netRevenueCents,
        taxCents: part.taxCents,
        restocked: part.restocked,
        cogsCents: part.restocked
          ? part.quantity * Number(part.component.unit_cost_cents || 0)
          : 0,
      })),
    }, { actorUserId, clampToOpenPeriod: true })
    for (const part of parts) {
      if (part.restocked && part.component.product_id && part.quantity > 0) {
        await restoreProductStock(
          client, tenantId, part.component.product_id, part.quantity,
          Number(part.component.unit_cost_cents || 0),
        )
      }
      await insertComponentAdjustment(
        client, tenantId, part.component.id, balanceRow.id,
        {
          refund_gid: refund.id,
          quantity: part.quantity,
          gross_cents: part.grossCents,
          net_revenue_cents: part.netRevenueCents,
          tax_cents: part.taxCents,
          restocked: part.restocked,
          ledger_transaction_id: posted.transactionId ?? null,
        },
      )
    }
    const feePosted = await postShopifyPaymentFee(client, tenantId, {
      id: balanceRow.id,
      remoteId: balanceRow.shopify_balance_transaction_gid,
      feeCents: balanceRow.fee_cents,
      transactionDate: balanceRow.transaction_date,
    }, { actorUserId, clampToOpenPeriod: true })
    await markBalanceTransaction(client, tenantId, balanceRow.id, {
      status: 'recorded',
      ledgerTransactionId: posted.transactionId ?? feePosted.transactionId ?? null,
      orderFinancialId: orderFinancial.id,
    })
    return true
  }, { db })
}

async function processDispute(db, tenantId, row, actorUserId) {
  const { settings } = await getSettings(db, tenantId)
  const account = settings.shopify_fee_expense_account_code
  if (!account) {
    await markBalanceTransaction(db, tenantId, row.id, { status: 'blocked' })
    return false
  }
  return withTransaction(async (client) => {
    const posted = await postShopifyPayoutAdjustment(client, tenantId, {
      id: row.id,
      remoteId: row.shopify_balance_transaction_gid,
      netCents: row.net_cents,
      transactionDate: row.transaction_date,
    }, account, { actorUserId, clampToOpenPeriod: true })
    await markBalanceTransaction(client, tenantId, row.id, {
      status: 'recorded', accountCode: account,
      ledgerTransactionId: posted.transactionId ?? null,
    })
    return true
  }, { db })
}

async function processOrderTransaction(db, tenantId, row, actorUserId, fetchImpl) {
  if (row.processing_status === 'recorded') return true
  const financial = row.associated_order_gid
    ? await findOrderFinancial(db, tenantId, row.associated_order_gid)
    : null
  if (!financial) {
    await markBalanceTransaction(db, tenantId, row.id, { status: 'blocked' })
    return false
  }
  if (row.source_type === 'REFUND' || row.transaction_type.includes('REFUND')) {
    const fetched = await fetchOrdersByIds(db, tenantId, [financial.shopify_order_gid], fetchImpl)
    if (fetched.error || !fetched.orders[0]) {
      await markBalanceTransaction(db, tenantId, row.id, { status: 'blocked' })
      return false
    }
    return processRefund(db, tenantId, row, financial, fetched.orders[0], actorUserId)
  }
  if (row.source_type === 'DISPUTE' || row.transaction_type.includes('CHARGEBACK')) {
    return processDispute(db, tenantId, row, actorUserId)
  }
  await markBalanceTransaction(db, tenantId, row.id, { status: 'blocked' })
  return false
}

async function syncOnePayout(db, tenantId, remotePayout, actorUserId, fetchImpl) {
  const payout = await upsertPayout(db, tenantId, remotePayout, false)
  const fetched = await fetchBalanceTransactions(db, tenantId, {
    payoutLegacyId: remotePayout.legacy_id,
  }, fetchImpl)
  if (fetched.error) return fetched
  const rows = []
  for (const remote of fetched.transactions) {
    const financial = remote.associated_order_gid
      ? await findOrderFinancial(db, tenantId, remote.associated_order_gid)
      : null
    const row = await upsertBalanceTransaction(db, tenantId, remote, {
      payoutId: payout.id,
      orderFinancialId: financial?.id ?? null,
    })
    rows.push(row)
  }
  const sum = rows.reduce((total, row) => total + row.net_cents, 0)
  const complete = sum === payout.net_cents
  await setPayoutSyncComplete(db, tenantId, payout.id, complete)
  if (!complete) return { payout, complete: false }
  for (const row of rows) {
    if (row.associated_order_gid || row.source_order_transaction_id) {
      await processOrderTransaction(db, tenantId, row, actorUserId, fetchImpl)
    } else if (row.processing_status === 'pending') {
      await markBalanceTransaction(db, tenantId, row.id, { status: 'needs_review' })
    }
  }
  return { payout, complete: true }
}

export async function syncShopifyPayouts(db, tenantId, {
  fromDate, toDate, actorUserId = null,
} = {}, fetchImpl = globalThis.fetch) {
  const fetched = await fetchPayouts(db, tenantId, fromDate, toDate, fetchImpl)
  if (fetched.error) return fetched
  const results = []
  for (const payout of fetched.payouts) {
    results.push(await syncOnePayout(db, tenantId, payout, actorUserId, fetchImpl))
  }
  return { synced: results.length, results }
}

export async function syncShopifyPayoutById(
  db, tenantId, payoutId, actorUserId = null, fetchImpl = globalThis.fetch,
) {
  const local = await getPayout(db, tenantId, payoutId)
  if (!local) return { error: { status: 404, body: { error: 'Shopify payout not found' } } }
  if (local.origin === 'custom') return { payout: local, complete: local.sync_complete }
  const issuedDate = new Date(local.issued_at).toISOString().slice(0, 10)
  const fetched = await fetchPayouts(db, tenantId, issuedDate, issuedDate, fetchImpl)
  if (fetched.error) return fetched
  const remote = fetched.payouts.find((payout) => payout.gid === local.shopify_payout_gid)
  if (!remote) return { error: { status: 409, body: { error: 'shopify_payout_not_found' } } }
  return syncOnePayout(db, tenantId, remote, actorUserId, fetchImpl)
}

function manualPayoutDto(payout, transactions) {
  const orders = new Map()
  for (const row of transactions) {
    if (!row.order_financial_id) continue
    const existing = orders.get(row.order_financial_id)
    if (existing) existing.net_cents += row.net_cents
    else {
      orders.set(row.order_financial_id, {
        id: row.order_financial_id,
        order_name: row.order_name ?? `#${row.shopify_order_legacy_id}`,
        shopify_order_id: row.shopify_order_legacy_id,
        net_cents: row.net_cents,
      })
    }
  }
  const adjustments = transactions
    .filter((row) => row.processing_status === 'needs_review')
    .map((row) => ({
      id: row.id,
      type: row.transaction_type,
      source_type: row.source_type,
      transaction_date: row.transaction_date,
      net_cents: row.net_cents,
    }))
  return {
    id: payout.id,
    shopify_payout_id: payout.origin === 'custom'
      ? payout.external_trace_id
      : payout.shopify_payout_legacy_id,
    origin: payout.origin,
    issued_at: payout.issued_at,
    transaction_type: payout.transaction_type,
    currency: payout.currency,
    net_cents: payout.net_cents,
    external_trace_id: payout.external_trace_id,
    ready: payout.sync_complete
      && payout.balance_transaction_count > 0
      && payout.balance_net_cents === payout.net_cents
      && Boolean(payout.covered),
    orders: [...orders.values()],
    adjustments,
  }
}

export async function listManualShopifyPayouts(db, tenantId, rawLimit = 100) {
  const limit = parseListLimit(rawLimit)
  if (limit === null) return badRequest('limit must be between 1 and 100', { code: 'invalid_limit' })
  const payouts = await listManualPayoutCandidates(db, tenantId, limit)
  const transactions = await listBalanceTransactionsForPayouts(
    db, tenantId, payouts.map((payout) => payout.id),
  )
  const customCandidates = await listCustomPayoutCandidates(db, tenantId, limit)
  const byPayout = new Map()
  for (const row of transactions) {
    const bucket = byPayout.get(row.payout_id)
    if (bucket) bucket.push(row)
    else byPayout.set(row.payout_id, [row])
  }
  return {
    items: payouts.map((payout) => manualPayoutDto(
      payout, byPayout.get(payout.id) ?? [],
    )),
    custom_candidates: customCandidates.map((candidate) => ({
      order_financial_id: candidate.order_financial_id,
      order_name: candidate.order_name,
      shopify_order_id: candidate.shopify_order_legacy_id,
      processed_at: candidate.processed_at,
      source_payout_id: candidate.shopify_payout_gid
        ? legacyId(candidate.shopify_payout_gid)
        : null,
      currency: candidate.currency,
      net_cents: candidate.net_cents,
      balance_transaction_ids: candidate.balance_transaction_ids.map(Number),
    })),
    meta: { limit },
  }
}

export async function createCustomShopifyPayout(
  db, tenantId, body, actorUserId = null,
) {
  const validated = validateCustomPayout(body)
  if (validated.error) return badRequest(validated.error, { code: 'invalid_custom_payout' })
  const {
    reference, issuedAt, netCents, balanceTransactionIds,
  } = validated.value
  const created = await withTransaction(async (client) => {
    const transactions = await lockCustomPayoutTransactions(
      client, tenantId, balanceTransactionIds,
    )
    if (transactions.length !== balanceTransactionIds.length) {
      abortTransaction(notFound('Shopify payment contribution not found'))
    }
    const currencies = new Set(transactions.map((transaction) => transaction.currency))
    if (currencies.size !== 1) {
      abortTransaction(badRequest('Shopify payment contributions must use one currency', {
        code: 'shopify_payout_currency_mismatch',
      }))
    }
    const uuid = randomUUID()
    const payout = await insertCustomPayout(client, tenantId, {
      gid: `gid://gigbuddy/ShopifyPaymentsPayout/${uuid}`,
      legacyId: `custom-${uuid}`,
      reference,
      currency: [...currencies][0],
      netCents,
      issuedAt: `${issuedAt}T12:00:00.000Z`,
      actorUserId,
    })
    const assigned = await assignBalanceTransactionsToPayout(
      client, tenantId, balanceTransactionIds, payout.id,
    )
    if (assigned !== balanceTransactionIds.length) {
      abortTransaction(conflict('A Shopify payment contribution is already assigned', {
        code: 'shopify_payment_contribution_assigned',
      }))
    }
    const contributionNet = transactions.reduce(
      (sum, transaction) => sum + transaction.net_cents, 0,
    )
    const difference = netCents - contributionNet
    if (difference) {
      await upsertBalanceTransaction(client, tenantId, {
        id: `gid://gigbuddy/ShopifyPaymentsBalanceTransaction/${uuid}-adjustment`,
        associated_order_gid: null,
        source_order_transaction_id: null,
        payout_gid: payout.shopify_payout_gid,
        source_type: 'CUSTOM_ADJUSTMENT',
        type: 'CUSTOM_ADJUSTMENT',
        transaction_date: `${issuedAt}T12:00:00.000Z`,
        currency: payout.currency,
        amount_cents: difference,
        fee_cents: 0,
        net_cents: difference,
        test: false,
      }, { payoutId: payout.id, initialStatus: 'needs_review' })
    }
    return payout
  }, { db })
  if (created?.error) return created
  return listManualShopifyPayouts(db, tenantId, 100)
}

export async function refreshManualShopifyPayouts(
  db, tenantId, body, actorUserId = null, fetchImpl = globalThis.fetch,
) {
  const validated = validatePayoutRefresh(body)
  if (validated.error) return badRequest(validated.error, { code: 'invalid_payout_range' })
  const synced = await syncShopifyPayouts(db, tenantId, {
    ...validated.value, actorUserId,
  }, fetchImpl)
  if (synced.error) return synced
  return listManualShopifyPayouts(db, tenantId, 100)
}

function payoutIncomplete() {
  return conflict('Shopify payout details are incomplete', {
    code: 'shopify_payout_incomplete',
  })
}

export async function settleShopifyPayoutManually(
  db, tenantId, payoutId, body, actorUserId = null,
) {
  const validated = validateManualPayoutSettlement(body)
  if (validated.error) return badRequest(validated.error, { code: 'invalid_payout_settlement' })
  const { entryDate, adjustmentMappings } = validated.value
  return withTransaction(async (client) => {
    const payout = await lockPayout(client, tenantId, payoutId)
    if (!payout) abortTransaction(notFound('Shopify payout not found'))
    if (payout.ledger_transaction_id != null || payout.reconciled_bank_statement_line_id != null) {
      abortTransaction(conflict('Shopify payout is already settled', {
        code: 'shopify_payout_already_settled',
      }))
    }
    if (payout.status !== 'PAID' || !payout.sync_complete) abortTransaction(payoutIncomplete())

    const transactions = await lockBalanceTransactionsForPayout(client, tenantId, payout.id)
    if (!transactions.length
        || transactions.reduce((sum, row) => sum + row.net_cents, 0) !== payout.net_cents
        || transactions.some((row) => !['recorded', 'needs_review'].includes(row.processing_status))) {
      abortTransaction(payoutIncomplete())
    }

    const mappings = new Map(
      adjustmentMappings.map((mapping) => [mapping.balanceTransactionId, mapping.accountCode]),
    )
    const requiredIds = new Set(
      transactions.filter((row) => row.processing_status === 'needs_review').map((row) => row.id),
    )
    if (mappings.size !== requiredIds.size
        || [...mappings.keys()].some((id) => !requiredIds.has(id))) {
      abortTransaction(badRequest('Categorize every Shopify payout adjustment', {
        code: 'shopify_payout_mapping_required',
      }))
    }
    for (const accountCode of mappings.values()) {
      const valid = (await accountExistsOfType(client, tenantId, accountCode, 'revenue'))
        || (await accountExistsOfType(client, tenantId, accountCode, 'expense'))
        || (await accountExistsOfType(client, tenantId, accountCode, 'cost_of_goods_sold'))
      if (!valid) {
        abortTransaction(badRequest('Invalid Shopify payout adjustment account', {
          code: 'invalid_account',
        }))
      }
    }

    for (const transaction of transactions) {
      if (transaction.processing_status !== 'needs_review') continue
      const accountCode = mappings.get(transaction.id)
      const adjustmentPosted = await postShopifyPayoutAdjustment(client, tenantId, {
        id: transaction.id,
        remoteId: transaction.shopify_balance_transaction_gid,
        netCents: transaction.net_cents,
        transactionDate: transaction.transaction_date,
      }, accountCode, { actorUserId, clampToOpenPeriod: true })
      await markBalanceTransaction(client, tenantId, transaction.id, {
        status: 'recorded', accountCode,
        ledgerTransactionId: adjustmentPosted.transactionId ?? null,
      })
    }

    const posted = await postShopifyPayoutSettlement(client, tenantId, {
      id: payout.id,
      remoteId: payout.shopify_payout_legacy_id,
      netCents: payout.net_cents,
      transactionType: payout.transaction_type,
      entryDate,
    }, { actorUserId, clampToOpenPeriod: true })
    const settled = await markPayoutManuallySettled(
      client, tenantId, payout.id, entryDate, posted.transactionId, actorUserId,
    )
    return { payout: settled }
  }, { db, mapError: ledgerErrorResult })
}
