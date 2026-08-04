import {
  listImportedLineIds,
  listFinanciallyImportedOrderIds,
} from '../repositories/shopifyImportRepository.js'
import { getAccessToken, invalidateToken } from './shopifyTokenService.js'
import {
  computeLineGrossInclCents,
  orderSkipReason,
  lineSkipReason,
  currentQuantity,
} from './shopifyImportMapping.js'
import { logger } from '../utils/logger.js'

export const SHOPIFY_API_VERSION = '2026-07'
const PAGE_SIZE = 50
const BALANCE_PAGE_SIZE = 250
const BALANCE_LOOKBACK_MS = 24 * 60 * 60 * 1000

const ORDERS_QUERY = `#graphql
  query GigbuddyOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: PROCESSED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        name
        createdAt
        processedAt
        cancelledAt
        currencyCode
        taxesIncluded
        test
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        netPaymentSet { shopMoney { amount currencyCode } }
        currentShippingPriceSet { shopMoney { amount currencyCode } }
        totalTipReceivedSet { shopMoney { amount currencyCode } }
        currentTotalDutiesSet { shopMoney { amount currencyCode } }
        currentTotalAdditionalFeesSet { shopMoney { amount currencyCode } }
        transactions {
          id
          kind
          status
          gateway
          test
        }
        lineItems(first: 250) {
          nodes {
            id
            title
            sku
            quantity
            currentQuantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            totalDiscountSet { shopMoney { amount currencyCode } }
            discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
          }
          pageInfo { hasNextPage endCursor }
        }
        refunds {
          id
          createdAt
          totalRefundedSet { shopMoney { amount currencyCode } }
          transactions(first: 250) {
            nodes { id kind status gateway test }
          }
          refundLineItems(first: 250) {
            nodes {
              id
              quantity
              restocked
              restockType
              subtotalSet { shopMoney { amount currencyCode } }
              totalTaxSet { shopMoney { amount currencyCode } }
              lineItem { id }
            }
            pageInfo { hasNextPage }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`

const NODES_QUERY = `#graphql
  query GigbuddyOrderNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        legacyResourceId
        name
        createdAt
        processedAt
        cancelledAt
        currencyCode
        taxesIncluded
        test
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        netPaymentSet { shopMoney { amount currencyCode } }
        currentShippingPriceSet { shopMoney { amount currencyCode } }
        totalTipReceivedSet { shopMoney { amount currencyCode } }
        currentTotalDutiesSet { shopMoney { amount currencyCode } }
        currentTotalAdditionalFeesSet { shopMoney { amount currencyCode } }
        transactions { id kind status gateway test }
        lineItems(first: 250) {
          nodes {
            id title sku quantity currentQuantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            totalDiscountSet { shopMoney { amount currencyCode } }
            discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
          }
          pageInfo { hasNextPage endCursor }
        }
        refunds {
          id createdAt
          totalRefundedSet { shopMoney { amount currencyCode } }
          transactions(first: 250) { nodes { id kind status gateway test } }
          refundLineItems(first: 250) {
            nodes {
              id quantity restocked restockType
              subtotalSet { shopMoney { amount currencyCode } }
              totalTaxSet { shopMoney { amount currencyCode } }
              lineItem { id }
            }
            pageInfo { hasNextPage }
          }
        }
      }
    }
  }`

const BALANCE_QUERY = `#graphql
  query GigbuddyBalanceTransactions($first: Int!, $after: String, $query: String) {
    shopifyPaymentsAccount {
      balanceTransactions(
        first: $first, after: $after, query: $query,
        sortKey: PROCESSED_AT, reverse: true, hideTransfers: true
      ) {
        nodes {
          id type sourceType sourceOrderTransactionId test transactionDate
          associatedOrder { id }
          associatedPayout { id status }
          amount { amount currencyCode }
          fee { amount currencyCode }
          net { amount currencyCode }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`

function shopifyError(status, error, extra = {}) {
  return { error: { status, body: { error, ...extra } } }
}

export function moneyToCents(value) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) throw new Error('Invalid Shopify money amount')
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('Shopify money amount is out of range')
  return match[1] ? -cents : cents
}

export function legacyId(gid) {
  const value = String(gid ?? '')
  return value.slice(value.lastIndexOf('/') + 1)
}

function orderGid(id) {
  const value = String(id)
  return value.startsWith('gid://') ? value : `gid://shopify/Order/${value}`
}

function graphqlError(errors) {
  const codes = new Set((errors ?? []).map((e) => e?.extensions?.code))
  if (codes.has('THROTTLED')) return shopifyError(429, 'shopify_rate_limited')
  if (codes.has('ACCESS_DENIED')) {
    return shopifyError(400, 'shopify_payments_scope_required', {
      message: 'The Shopify app needs read_shopify_payments and payout access.',
    })
  }
  return shopifyError(502, 'shopify_error')
}

function graphqlOperationName(query) {
  return String(query).match(/\b(?:query|mutation)\s+([_A-Za-z][_0-9A-Za-z]*)/)?.[1]
    ?? 'anonymous'
}

function dumpGraphqlResponse(tenantId, query, status, body) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return
  logger.info('shopify.graphql_response', {
    tenantId,
    operation: graphqlOperationName(query),
    status,
    shopifyResponseJson: JSON.stringify(body),
  })
}

export async function shopifyGraphql(executor, tenantId, query, variables, fetchImpl = globalThis.fetch) {
  const creds = await getAccessToken(executor, tenantId, fetchImpl)
  if (creds.error) return creds
  let response
  try {
    response = await fetchImpl(
      `https://${creds.domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': creds.token,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      },
    )
  } catch {
    return shopifyError(502, 'shopify_unreachable')
  }
  if (response.status === 401) {
    invalidateToken(tenantId)
    return shopifyError(400, 'shopify_unauthorized', {
      message: 'Shopify rejected the access token.',
    })
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After')) || null
    return shopifyError(429, 'shopify_rate_limited', { retry_after: retryAfter })
  }
  if (!response.ok) return shopifyError(502, 'shopify_error', { upstream_status: response.status })
  const body = await response.json()
  dumpGraphqlResponse(tenantId, query, response.status, body)
  if (body.errors?.length) return graphqlError(body.errors)
  return { data: body.data }
}

function moneyBagCents(bag) {
  return moneyToCents(bag?.shopMoney?.amount ?? 0)
}

function moneyCurrency(money) {
  return String(money?.currencyCode ?? '').toUpperCase()
}

function toExtra(key, kind, title, bag) {
  const amountCents = moneyBagCents(bag)
  if (!amountCents) return null
  return {
    key,
    kind,
    title,
    amount_cents: amountCents,
    currency: moneyCurrency(bag?.shopMoney),
  }
}

function isTipLine(line) {
  return new Set(['tip', 'tips', 'fooi']).has(String(line.title ?? '').trim().toLowerCase())
}

function tipAlreadyRepresentedByLines(order, lineItems) {
  const reportedTipCents = moneyBagCents(order.totalTipReceivedSet)
  if (!reportedTipCents) return false
  const tipLineCents = lineItems
    .filter(isTipLine)
    .reduce((sum, line) => sum + computeLineGrossInclCents(
      { taxes_included: true }, line, 0,
    ), 0)
  return tipLineCents === reportedTipCents
}

function toSlimOrder(order) {
  const id = String(order.legacyResourceId ?? legacyId(order.id))
  const lineItemsIncomplete = Boolean(order.lineItems?.pageInfo?.hasNextPage)
  const refundsIncomplete = (order.refunds ?? []).some((r) => r.refundLineItems?.pageInfo?.hasNextPage)
  const lineItems = (order.lineItems?.nodes ?? []).map((line) => ({
    id: legacyId(line.id),
    gid: line.id,
    title: line.title,
    sku: line.sku ?? null,
    quantity: line.quantity,
    current_quantity: currentQuantity({ current_quantity: line.currentQuantity, quantity: line.quantity }),
    price: line.originalUnitPriceSet?.shopMoney?.amount ?? '0.00',
    total_discount: line.totalDiscountSet?.shopMoney?.amount ?? '0.00',
    discount_allocations: (line.discountAllocations ?? []).map((allocation) => ({
      amount: allocation.allocatedAmountSet?.shopMoney?.amount ?? '0.00',
    })),
  }))
  const tipIsLineItem = tipAlreadyRepresentedByLines(order, lineItems)
  const extraComponents = [
    toExtra(`${id}:shipping`, 'shipping', 'Shipping', order.currentShippingPriceSet),
    tipIsLineItem ? null : toExtra(`${id}:tip`, 'tip', 'Tips', order.totalTipReceivedSet),
    toExtra(`${id}:duty`, 'duty', 'Duties', order.currentTotalDutiesSet),
    toExtra(`${id}:additional-fee`, 'additional_fee', 'Additional fees', order.currentTotalAdditionalFeesSet),
  ].filter(Boolean)
  return {
    id,
    gid: order.id,
    name: order.name,
    created_at: order.createdAt,
    processed_at: order.processedAt,
    financial_status: String(order.displayFinancialStatus ?? '').toLowerCase(),
    fulfillment_status: order.displayFulfillmentStatus
      ? String(order.displayFulfillmentStatus).toLowerCase()
      : null,
    cancelled_at: order.cancelledAt ?? null,
    currency: String(order.currencyCode ?? '').toUpperCase(),
    taxes_included: Boolean(order.taxesIncluded),
    test: Boolean(order.test),
    total_incl_cents: moneyBagCents(order.currentTotalPriceSet),
    net_payment_cents: moneyBagCents(order.netPaymentSet),
    transaction_ids: (order.transactions ?? [])
      .filter((tx) => tx.status === 'SUCCESS')
      .map((tx) => legacyId(tx.id)),
    transactions: order.transactions ?? [],
    refunds: order.refunds ?? [],
    incomplete: lineItemsIncomplete || refundsIncomplete,
    line_items: lineItems,
    extra_components: extraComponents,
  }
}

function toBalanceTransaction(node) {
  const currencies = [
    moneyCurrency(node.amount), moneyCurrency(node.fee), moneyCurrency(node.net),
  ].filter(Boolean)
  return {
    id: node.id,
    type: node.type,
    source_type: node.sourceType ?? null,
    source_order_transaction_id: node.sourceOrderTransactionId == null
      ? null
      : String(node.sourceOrderTransactionId),
    associated_order_gid: node.associatedOrder?.id ?? null,
    payout_gid: node.associatedPayout?.id ?? null,
    payout_status: node.associatedPayout?.status ?? null,
    transaction_date: node.transactionDate,
    amount_cents: moneyToCents(node.amount?.amount ?? 0),
    fee_cents: moneyToCents(node.fee?.amount ?? 0),
    net_cents: moneyToCents(node.net?.amount ?? 0),
    currency: currencies[0] ?? '',
    currency_mismatch: new Set(currencies).size > 1,
    test: Boolean(node.test),
  }
}

export async function fetchBalanceTransactions(executor, tenantId, {
  processedSince = null, payoutLegacyId = null,
} = {}, fetchImpl = globalThis.fetch) {
  const filters = []
  if (processedSince) filters.push(`processed_at:>=${JSON.stringify(String(processedSince))}`)
  if (payoutLegacyId) filters.push(`payments_transfer_id:${payoutLegacyId}`)
  const search = filters.length ? filters.join(' ') : null
  const transactions = []
  let after = null
  do {
    const result = await shopifyGraphql(executor, tenantId, BALANCE_QUERY, {
      first: BALANCE_PAGE_SIZE, after, query: search,
    }, fetchImpl)
    if (result.error) return result
    const connection = result.data?.shopifyPaymentsAccount?.balanceTransactions
    if (!connection) return shopifyError(400, 'shopify_payments_unavailable')
    transactions.push(...connection.nodes.map(toBalanceTransaction))
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
  } while (after)
  return { transactions }
}

function matchTransactions(order, transactions) {
  const transactionIds = new Set(order.transaction_ids)
  const seen = new Set()
  return transactions.filter((tx) => {
    const matches = tx.associated_order_gid === order.gid
      || (tx.source_order_transaction_id && transactionIds.has(tx.source_order_transaction_id))
    if (!matches || seen.has(tx.id)) return false
    seen.add(tx.id)
    return true
  })
}

function paymentSummary(order, transactions) {
  const orderGateway = (order.transactions ?? []).some(
    (tx) => String(tx.gateway ?? '').toLowerCase().includes('paypal'),
  ) ? 'paypal' : 'shopify_payments'
  if (order.test || transactions.some((tx) => tx.test)) {
    return {
      status: 'test', payment_gateway: orderGateway, amount_cents: 0,
      fee_cents: 0, net_cents: 0, transactions: [], payout_ids: [],
    }
  }
  if (!transactions.length) {
    const successfulGateways = [...new Set((order.transactions ?? [])
      .filter((tx) => tx.status === 'SUCCESS')
      .map((tx) => String(tx.gateway ?? '').trim().toLowerCase())
      .filter(Boolean))]
    if (successfulGateways.length === 1 && successfulGateways[0].includes('paypal')) {
      return {
        status: 'ready', payment_gateway: 'paypal', amount_cents: order.net_payment_cents,
        fee_cents: null, net_cents: null, transactions: [], payout_ids: [],
      }
    }
    if (successfulGateways.length && !successfulGateways.includes('shopify_payments')) {
      return {
        status: 'unsupported', payment_gateway: successfulGateways.join(','),
        amount_cents: order.net_payment_cents, fee_cents: null, net_cents: null,
        transactions: [], payout_ids: [],
      }
    }
    return {
      status: 'pending', payment_gateway: 'shopify_payments', amount_cents: 0,
      fee_cents: 0, net_cents: 0, transactions: [], payout_ids: [],
    }
  }
  const amount = transactions.reduce((sum, tx) => sum + tx.amount_cents, 0)
  const fee = transactions.reduce((sum, tx) => sum + tx.fee_cents, 0)
  const net = transactions.reduce((sum, tx) => sum + tx.net_cents, 0)
  const invalid = transactions.some((tx) => tx.currency_mismatch || tx.currency !== order.currency)
    || amount - fee !== net
    || amount !== order.net_payment_cents
  return {
    status: invalid ? 'mismatch' : 'ready',
    payment_gateway: 'shopify_payments',
    amount_cents: amount,
    fee_cents: fee,
    net_cents: net,
    transactions,
    payout_ids: [...new Set(transactions.map((tx) => tx.payout_gid).filter(Boolean))],
  }
}

async function annotateOrders(executor, tenantId, orders, balanceTransactions) {
  const ids = orders.map((order) => order.id)
  const [importedLineIds, financiallyImportedIds] = await Promise.all([
    listImportedLineIds(executor, tenantId, ids),
    listFinanciallyImportedOrderIds(executor, tenantId, ids),
  ])
  return orders.map((order) => {
    const payment = paymentSummary(order, matchTransactions(order, balanceTransactions))
    let skipReason = orderSkipReason(order)
    if (!skipReason && order.incomplete) skipReason = 'skipped_incomplete_order'
    if (!skipReason && payment.status === 'pending') skipReason = 'skipped_payment_pending'
    if (!skipReason && payment.status === 'mismatch') skipReason = 'skipped_payment_mismatch'
    if (!skipReason && payment.status === 'test') skipReason = 'skipped_test_order'
    if (!skipReason && payment.status === 'unsupported') skipReason = 'skipped_unsupported_payment_gateway'
    const lineItems = order.line_items.map((line) => ({
      ...line,
      already_imported: importedLineIds.has(line.id),
      skip_reason: lineSkipReason(line),
    }))
    const legacyPartial = !financiallyImportedIds.has(order.id)
      && lineItems.some((line) => line.already_imported)
    if (!skipReason && legacyPartial) skipReason = 'skipped_legacy_partial_import'
    return {
      ...order,
      line_items: lineItems,
      payment,
      skip_reason: skipReason,
      fully_imported: financiallyImportedIds.has(order.id),
    }
  })
}

async function balancesForOrders(executor, tenantId, orders, fetchImpl) {
  if (!orders.length) return { transactions: [] }
  const oldest = orders.map((order) => order.processed_at).filter(Boolean).sort()[0]
  const oldestTimestamp = Date.parse(oldest)
  const processedSince = Number.isFinite(oldestTimestamp)
    ? new Date(oldestTimestamp - BALANCE_LOOKBACK_MS).toISOString().replace('.000Z', 'Z')
    : oldest
  return fetchBalanceTransactions(executor, tenantId, { processedSince }, fetchImpl)
}

export async function fetchRecentOrders(executor, tenantId, { cursor, limit = PAGE_SIZE } = {}, fetchImpl = globalThis.fetch) {
  const first = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), PAGE_SIZE)
  const result = await shopifyGraphql(executor, tenantId, ORDERS_QUERY, {
    first, after: cursor || null,
  }, fetchImpl)
  if (result.error) return result
  const connection = result.data?.orders
  const orders = (connection?.nodes ?? []).map(toSlimOrder)
  const balances = await balancesForOrders(executor, tenantId, orders, fetchImpl)
  if (balances.error) return balances
  return {
    orders: await annotateOrders(executor, tenantId, orders, balances.transactions),
    nextCursor: connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null,
  }
}

export async function fetchOrdersByIds(executor, tenantId, ids, fetchImpl = globalThis.fetch) {
  const unique = [...new Set(ids.map(orderGid))]
  const result = await shopifyGraphql(executor, tenantId, NODES_QUERY, { ids: unique }, fetchImpl)
  if (result.error) return result
  const orders = (result.data?.nodes ?? []).filter(Boolean).map(toSlimOrder)
  const balances = await balancesForOrders(executor, tenantId, orders, fetchImpl)
  if (balances.error) return balances
  return { orders: await annotateOrders(executor, tenantId, orders, balances.transactions) }
}
