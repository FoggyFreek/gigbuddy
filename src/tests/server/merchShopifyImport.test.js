import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let importShopifyOrders, fetchRecentOrders, fetchOrdersByIds, resetShopifyTokenCacheForTests
let syncShopifyPayouts, listManualShopifyPayouts, settleShopifyPayoutManually, commitImport
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const importMod = await import('../../../server/services/merchShopifyService.js')
  const shopMod = await import('../../../server/services/shopifyService.js')
  const tokenMod = await import('../../../server/services/shopifyTokenService.js')
  const payoutMod = await import('../../../server/services/shopifyPayoutService.js')
  const bankMod = await import('../../../server/services/bankImportService.js')
  ;({ pool, runMigrations, truncateAll, seedTwoTenants } = dbMod)
  app = appMod.createTestApp()
  ;({ importShopifyOrders } = importMod)
  ;({ fetchRecentOrders, fetchOrdersByIds } = shopMod)
  ;({ resetShopifyTokenCacheForTests } = tokenMod)
  ;({ syncShopifyPayouts, listManualShopifyPayouts, settleShopifyPayoutManually } = payoutMod)
  ;({ commitImport } = bankMod)
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  resetShopifyTokenCacheForTests()
})

afterAll(async () => pool.end())

function asUserA(req) {
  return req.set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

function jsonResponse(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  }
}

const TOKEN_BODY = {
  access_token: 'shptest-token',
  scope: 'read_orders,read_shopify_payments',
  expires_in: 86399,
}

function lineNode(overrides = {}) {
  const id = String(overrides.id ?? 5001)
  return {
    id: `gid://shopify/LineItem/${id}`,
    title: 'Band T-Shirt', sku: 'TS', quantity: 1, currentQuantity: 1,
    originalUnitPriceSet: { shopMoney: { amount: '36.30', currencyCode: 'EUR' } },
    totalDiscountSet: { shopMoney: { amount: '0.00', currencyCode: 'EUR' } },
    discountAllocations: [],
    ...overrides,
  }
}

function orderNode(overrides = {}) {
  const id = String(overrides.legacyResourceId ?? 1001)
  return {
    id: `gid://shopify/Order/${id}`,
    legacyResourceId: id,
    name: `#${id}`,
    createdAt: '2026-06-01T10:00:00Z',
    processedAt: '2026-06-01T10:00:00Z',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
    cancelledAt: null, currencyCode: 'EUR', taxesIncluded: true, test: false,
    currentTotalPriceSet: { shopMoney: { amount: '36.30', currencyCode: 'EUR' } },
    netPaymentSet: { shopMoney: { amount: '36.30', currencyCode: 'EUR' } },
    currentShippingPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'EUR' } },
    totalTipReceivedSet: { shopMoney: { amount: '0.00', currencyCode: 'EUR' } },
    currentTotalDutiesSet: null,
    currentTotalAdditionalFeesSet: null,
    transactions: [{
      id: 'gid://shopify/OrderTransaction/7001',
      status: 'SUCCESS', kind: 'SALE', gateway: 'shopify_payments',
    }],
    refunds: [],
    lineItems: { nodes: [lineNode()], pageInfo: { hasNextPage: false } },
    ...overrides,
  }
}

function balanceNode(overrides = {}) {
  return {
    id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/bt-1',
    type: 'CHARGE', sourceType: 'CHARGE', sourceOrderTransactionId: '7001',
    associatedOrder: { id: 'gid://shopify/Order/1001' },
    associatedPayout: { id: 'gid://shopify/ShopifyPaymentsPayout/9001', status: 'PAID' },
    transactionDate: '2026-06-01T10:01:00Z', test: false,
    amount: { amount: '36.30', currencyCode: 'EUR' },
    fee: { amount: '1.00', currencyCode: 'EUR' },
    net: { amount: '35.30', currencyCode: 'EUR' },
    ...overrides,
  }
}

function shopifyFetch({
  orders = [orderNode()], balances = [balanceNode()], pageInfo, status = 200,
  payouts = [{
    id: 'gid://shopify/ShopifyPaymentsPayout/9001', legacyResourceId: '9001',
    status: 'PAID', transactionType: 'DEPOSIT', issuedAt: '2026-06-03T10:00:00Z',
    externalTraceId: 'TRACE-9001', net: { amount: '35.30', currencyCode: 'EUR' },
  }],
} = {}) {
  const calls = []
  const fn = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).includes('/admin/oauth/access_token')) return jsonResponse(TOKEN_BODY)
    if (status !== 200) return jsonResponse({}, status)
    const requestBody = JSON.parse(options.body)
    if (requestBody.query.includes('GigbuddyBalanceTransactions')) {
      return jsonResponse({ data: { shopifyPaymentsAccount: { balanceTransactions: {
        nodes: balances, pageInfo: { hasNextPage: false, endCursor: null },
      } } } })
    }
    if (requestBody.query.includes('GigbuddyPayouts')) {
      return jsonResponse({ data: { shopifyPaymentsAccount: { payouts: {
        nodes: payouts, pageInfo: { hasNextPage: false, endCursor: null },
      } } } })
    }
    if (requestBody.query.includes('GigbuddyOrderNodes')) {
      return jsonResponse({ data: { nodes: orders } })
    }
    return jsonResponse({ data: { orders: {
      nodes: orders,
      pageInfo: pageInfo ?? { hasNextPage: false, endCursor: null },
    } } })
  }
  fn.calls = calls
  return fn
}

async function configureShopify(tenantId) {
  await pool.query(
    `INSERT INTO tenant_integrations (
       shopify_client_id, shopify_client_secret, shopify_shop_domain, tenant_id
     ) VALUES ($1, $2, $3, $4)`,
    ['a'.repeat(32), 'b'.repeat(32), 'test-band.myshopify.com', tenantId],
  )
}

async function createProduct() {
  const res = await asUserA(request(app).post('/api/merch/products')).send({
    name: 'Band T-Shirt', unit_cost_cents: 1200,
    default_price_incl_cents: 3630, vat_rate: 21,
  }).expect(201)
  return res.body
}

async function stockProduct(productId, quantity) {
  await asUserA(request(app).post('/api/purchases')).send({
    supplier_name: 'Merch Printer', receipt_date: '2026-05-01', status: 'approved',
    lines: [{
      description: 'batch', tax_rate: 21,
      amount_incl_cents: quantity * 1200 * 1.21,
      product_id: productId, quantity,
    }],
  }).expect(201)
}

function importBody(productId) {
  return { orders: [{
    shopify_order_id: '1001',
    lines: [{ shopify_line_id: '5001', mapping: { type: 'product', product_id: productId } }],
    extra_components: [],
  }] }
}

function paypalOrderNode({ orderId, lineId, transactionId, amount }) {
  return orderNode({
    legacyResourceId: String(orderId),
    name: `#${orderId}`,
    currentTotalPriceSet: { shopMoney: { amount, currencyCode: 'EUR' } },
    netPaymentSet: { shopMoney: { amount, currencyCode: 'EUR' } },
    transactions: [{
      id: `gid://shopify/OrderTransaction/${transactionId}`,
      status: 'SUCCESS', kind: 'SALE', gateway: 'paypal',
    }],
    lineItems: {
      nodes: [lineNode({
        id: String(lineId),
        originalUnitPriceSet: { shopMoney: { amount, currencyCode: 'EUR' } },
      })],
      pageInfo: { hasNextPage: false },
    },
  })
}

function selectedOrder(productId, orderId, lineId) {
  return {
    shopify_order_id: String(orderId),
    lines: [{ shopify_line_id: String(lineId), mapping: { type: 'product', product_id: productId } }],
    extra_components: [],
  }
}

describe('Shopify Payments order import', () => {
  it('atomically records revenue, inventory, actual fee and expected payout contribution', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)

    const result = await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id, shopifyFetch(),
    )
    expect(result).toMatchObject({
      imported: 1,
      results: [{ shopify_order_id: '1001', status: 'imported', fee_cents: 100, net_cents: 3530 }],
    })

    const { rows: financials } = await pool.query(
      'SELECT * FROM shopify_order_financials WHERE tenant_id = $1', [tenantId],
    )
    expect(financials[0]).toMatchObject({ gross_cents: 3630, fee_cents: 100, net_cents: 3530 })
    const { rows: entries } = await pool.query(
      `SELECT account_code, SUM(debit_cents)::int debit, SUM(credit_cents)::int credit
         FROM ledger_entries WHERE tenant_id = $1 GROUP BY account_code`, [tenantId],
    )
    const byCode = Object.fromEntries(entries.map((row) => [row.account_code, row]))
    expect(byCode['11300']).toMatchObject({ debit: 3630, credit: 100 })
    expect(byCode['64100'].debit).toBe(100)
    expect(byCode['42000'].credit).toBe(3000)
    expect(byCode['24000'].credit).toBe(630)
    expect(byCode['51000'].debit).toBe(1200)
    expect(byCode['12200'].credit).toBe(1200)
    const { rows: feeTransactions } = await pool.query(
      `SELECT description
         FROM ledger_transactions
        WHERE tenant_id = $1
          AND source_type = 'shopify_balance_transaction'
          AND source_event = 'fee'`,
      [tenantId],
    )
    expect(feeTransactions).toEqual([{
      description: 'Shopify Payments fee (bt-1)',
    }])
  })

  it('does not import any component when one component has insufficient stock', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 1)
    const order = orderNode({
      lineItems: { nodes: [lineNode({ quantity: 2, currentQuantity: 2 })], pageInfo: { hasNextPage: false } },
      currentTotalPriceSet: { shopMoney: { amount: '72.60', currencyCode: 'EUR' } },
      netPaymentSet: { shopMoney: { amount: '72.60', currencyCode: 'EUR' } },
    })
    const balance = balanceNode({
      amount: { amount: '72.60', currencyCode: 'EUR' }, fee: { amount: '2.00', currencyCode: 'EUR' },
      net: { amount: '70.60', currencyCode: 'EUR' },
    })
    const result = await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id,
      shopifyFetch({ orders: [order], balances: [balance] }),
    )
    expect(result.results[0].status).toBe('skipped_insufficient_stock')
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int n FROM shopify_order_financials WHERE tenant_id = $1', [tenantId],
    )
    expect(rows[0].n).toBe(0)
  })

  it('waits until a matching Shopify Payments balance transaction exists', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const result = await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id,
      shopifyFetch({ balances: [] }),
    )
    expect(result.results[0].status).toBe('skipped_payment_pending')
  })

  it('matches by sourceOrderTransactionId when associatedOrder is absent', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const result = await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id,
      shopifyFetch({ balances: [balanceNode({ associatedOrder: null })] }),
    )
    expect(result.imported).toBe(1)
  })

  it('imports a successful PayPal order to PayPal clearing without inventing fee data', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const paypalOrder = paypalOrderNode({
      orderId: 1001, lineId: 5001, transactionId: 7001, amount: '36.30',
    })

    const result = await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id,
      shopifyFetch({ orders: [paypalOrder], balances: [] }),
    )

    expect(result).toMatchObject({
      imported: 1,
      results: [{
        shopify_order_id: '1001', status: 'imported', fee_cents: null, net_cents: null,
      }],
    })
    const { rows: financials } = await pool.query(
      'SELECT * FROM shopify_order_financials WHERE tenant_id = $1', [tenantId],
    )
    expect(financials[0]).toMatchObject({
      payment_gateway: 'paypal', gross_cents: 3630, fee_cents: null, net_cents: null,
    })
    const { rows: clearing } = await pool.query(
      `SELECT account_code, SUM(debit_cents - credit_cents)::int balance
         FROM ledger_entries
        WHERE tenant_id = $1 AND account_code IN ('11300', '11400', '64100')
        GROUP BY account_code`, [tenantId],
    )
    expect(clearing).toEqual([{ account_code: '11400', balance: 3630 }])
  })
})

describe('Shopify GraphQL order listing', () => {
  it('does not add totalTipReceived again when a matching tip line item exists', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const order = orderNode({
      currentTotalPriceSet: { shopMoney: { amount: '30.94', currencyCode: 'EUR' } },
      netPaymentSet: { shopMoney: { amount: '30.94', currencyCode: 'EUR' } },
      currentShippingPriceSet: { shopMoney: { amount: '5.95', currencyCode: 'EUR' } },
      totalTipReceivedSet: { shopMoney: { amount: '5.00', currencyCode: 'EUR' } },
      lineItems: {
        nodes: [
          lineNode({
            originalUnitPriceSet: { shopMoney: { amount: '19.99', currencyCode: 'EUR' } },
          }),
          lineNode({
            id: '5002', title: 'Tip', sku: null,
            originalUnitPriceSet: { shopMoney: { amount: '5.00', currencyCode: 'EUR' } },
          }),
        ],
        pageInfo: { hasNextPage: false },
      },
    })
    const balance = balanceNode({
      amount: { amount: '30.94', currencyCode: 'EUR' },
      fee: { amount: '1.80', currencyCode: 'EUR' },
      net: { amount: '29.14', currencyCode: 'EUR' },
    })

    const result = await fetchRecentOrders(
      pool, tenantId, {}, shopifyFetch({ orders: [order], balances: [balance] }),
    )

    expect(result.orders[0].extra_components).toEqual([
      expect.objectContaining({ kind: 'shipping', amount_cents: 595 }),
    ])
    expect(result.orders[0].payment).toMatchObject({
      status: 'ready', amount_cents: 3094, fee_cents: 180, net_cents: 2914,
    })
  })

  it('quotes the balance timestamp and looks back for charges processed before the order', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const fetchImpl = shopifyFetch()

    await fetchRecentOrders(pool, tenantId, {}, fetchImpl)

    const balanceCall = fetchImpl.calls
      .filter(({ url }) => url.includes('/graphql.json'))
      .map(({ options }) => JSON.parse(options.body))
      .find(({ query }) => query?.includes('GigbuddyBalanceTransactions'))
    expect(balanceCall.variables.query).toBe(
      'processed_at:>="2026-05-31T10:00:00Z"',
    )
  })

  it('dumps Shopify GraphQL response JSON in development', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await fetchRecentOrders(pool, tenantId, {}, shopifyFetch())

      const entries = log.mock.calls
        .map(([line]) => JSON.parse(line))
        .filter((entry) => entry.event === 'shopify.graphql_response')
      expect(entries.map((entry) => entry.operation)).toEqual([
        'GigbuddyOrders', 'GigbuddyBalanceTransactions',
      ])
      expect(JSON.parse(entries[0].shopifyResponseJson).data.orders.nodes[0].name).toBe('#1001')
      expect(entries[0]).toMatchObject({ tenantId, status: 200 })
    } finally {
      log.mockRestore()
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })

  it('does not request the unsupported legacyResourceId field on OrderTransaction', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const fetchImpl = shopifyFetch()

    await fetchRecentOrders(pool, tenantId, {}, fetchImpl)
    await fetchOrdersByIds(pool, tenantId, ['1001'], fetchImpl)

    const orderQueries = fetchImpl.calls
      .filter(({ url }) => url.includes('/graphql.json'))
      .map(({ options }) => JSON.parse(options.body).query)
      .filter((query) => query.includes('GigbuddyOrders') || query.includes('GigbuddyOrderNodes'))
    expect(orderQueries).toHaveLength(2)
    for (const query of orderQueries) {
      expect(query).not.toMatch(/transactions\s*\{\s*id\s+legacyResourceId/)
      expect(query).not.toContain('nodes { id legacyResourceId kind')
    }
  })

  it('returns fee/net data and the GraphQL cursor', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const result = await fetchRecentOrders(pool, tenantId, {}, shopifyFetch({
      pageInfo: { hasNextPage: true, endCursor: 'NEXT' },
    }))
    expect(result.nextCursor).toBe('NEXT')
    expect(result.orders[0]).toMatchObject({
      id: '1001', fully_imported: false,
      payment: { status: 'ready', fee_cents: 100, net_cents: 3530 },
    })
  })

  it('maps HTTP throttling to shopify_rate_limited', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const result = await fetchRecentOrders(pool, tenantId, {}, shopifyFetch({ status: 429 }))
    expect(result.error).toMatchObject({ status: 429, body: { error: 'shopify_rate_limited' } })
  })

  it('returns shopify_not_configured when credentials are missing', async () => {
    const response = await asUserA(request(app).get('/api/merch/shopify/orders')).expect(400)
    expect(response.body.error).toBe('shopify_not_configured')
  })
})

describe('Shopify payout reconciliation', () => {
  it('quotes the payout date range sent to Shopify', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const fetchImpl = shopifyFetch({ payouts: [] })

    await syncShopifyPayouts(pool, tenantId, {
      fromDate: '2026-06-01', toDate: '2026-06-05', actorUserId: seed.userA.id,
    }, fetchImpl)

    const payoutCall = fetchImpl.calls
      .filter(({ url }) => url.includes('/graphql.json'))
      .map(({ options }) => JSON.parse(options.body))
      .find(({ query }) => query.includes('GigbuddyPayouts'))
    expect(payoutCall.variables.query).toBe(
      'issued_at:>="2026-06-01" issued_at:<="2026-06-05"',
    )
  })

  it('manually records a paid Shopify payout on the primary bank account exactly once', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const fetchImpl = shopifyFetch()
    expect((await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id, fetchImpl,
    )).imported).toBe(1)
    expect((await syncShopifyPayouts(pool, tenantId, {
      fromDate: '2026-06-01', toDate: '2026-06-05', actorUserId: seed.userA.id,
    }, fetchImpl)).synced).toBe(1)

    const candidates = await listManualShopifyPayouts(pool, tenantId)
    expect(candidates.items).toEqual([
      expect.objectContaining({
        net_cents: 3530, ready: true,
        orders: [expect.objectContaining({ order_name: '#1001', net_cents: 3530 })],
      }),
    ])
    const payout = candidates.items[0]
    const settled = await settleShopifyPayoutManually(pool, tenantId, payout.id, {
      entry_date: '2026-06-04', adjustment_mappings: [],
    }, seed.userA.id)
    expect(settled).toMatchObject({
      payout: { id: payout.id, settlement_method: 'manual' },
    })

    const { rows: entries } = await pool.query(
      `SELECT le.account_code, le.debit_cents, le.credit_cents
         FROM ledger_transactions lt
         JOIN ledger_entries le ON le.transaction_id = lt.id AND le.tenant_id = lt.tenant_id
        WHERE lt.tenant_id = $1 AND lt.source_type = 'shopify_payout'
        ORDER BY le.account_code`, [tenantId],
    )
    expect(entries).toEqual([
      expect.objectContaining({ account_code: '11000', debit_cents: 3530, credit_cents: 0 }),
      expect.objectContaining({ account_code: '11300', debit_cents: 0, credit_cents: 3530 }),
    ])
    const { rows: clearing } = await pool.query(
      `SELECT COALESCE(SUM(debit_cents - credit_cents), 0)::int balance
         FROM ledger_entries WHERE tenant_id = $1 AND account_code = '11300'`, [tenantId],
    )
    expect(clearing[0].balance).toBe(0)

    const duplicate = await settleShopifyPayoutManually(pool, tenantId, payout.id, {
      entry_date: '2026-06-04', adjustment_mappings: [],
    }, seed.userA.id)
    expect(duplicate.error).toMatchObject({
      status: 409, body: { code: 'shopify_payout_already_settled' },
    })
    expect((await listManualShopifyPayouts(pool, tenantId)).items).toEqual([])
  })

  it('creates and settles a custom payout from older unassigned order contributions', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    expect((await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id, shopifyFetch(),
    )).imported).toBe(1)

    const before = await listManualShopifyPayouts(pool, tenantId)
    expect(before.custom_candidates).toEqual([
      expect.objectContaining({
        order_name: '#1001', net_cents: 3530, currency: 'EUR',
        balance_transaction_ids: [expect.any(Number)],
      }),
    ])

    const created = await asUserA(request(app).post('/api/merch/shopify/payouts/custom'))
      .send({
        reference: 'Legacy payout June 2026',
        issued_at: '2026-06-04',
        net_cents: 3500,
        balance_transaction_ids: before.custom_candidates[0].balance_transaction_ids,
      })
      .expect(201)

    expect(created.body.custom_candidates).toEqual([])
    expect(created.body.items).toEqual([
      expect.objectContaining({
        origin: 'custom', shopify_payout_id: 'Legacy payout June 2026',
        net_cents: 3500, ready: true,
        orders: [expect.objectContaining({ order_name: '#1001', net_cents: 3530 })],
        adjustments: [expect.objectContaining({
          type: 'CUSTOM_ADJUSTMENT', net_cents: -30,
        })],
      }),
    ])

    const payout = created.body.items[0]
    const settled = await settleShopifyPayoutManually(pool, tenantId, payout.id, {
      entry_date: '2026-06-04',
      adjustment_mappings: [{
        balance_transaction_id: payout.adjustments[0].id,
        account_code: '64100',
      }],
    }, seed.userA.id)
    expect(settled.payout).toMatchObject({
      origin: 'custom', settlement_method: 'manual', net_cents: 3500,
    })

    const { rows: balances } = await pool.query(
      `SELECT account_code, SUM(debit_cents - credit_cents)::int AS balance
         FROM ledger_entries
        WHERE tenant_id = $1 AND account_code IN ('11000', '11300')
        GROUP BY account_code ORDER BY account_code`,
      [tenantId],
    )
    expect(balances).toEqual([
      { account_code: '11000', balance: 3500 },
      { account_code: '11300', balance: 0 },
    ])
  })

  it('does not let another tenant create a custom payout from an order contribution', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id, shopifyFetch(),
    )
    const candidate = (await listManualShopifyPayouts(pool, tenantId)).custom_candidates[0]

    const response = await request(app)
      .post('/api/merch/shopify/payouts/custom')
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(seed.tenantB.id))
      .send({
        reference: 'Cross-tenant payout', issued_at: '2026-06-04', net_cents: 3530,
        balance_transaction_ids: candidate.balance_transaction_ids,
      })
      .expect(404)
    expect(response.body.error).toBe('Shopify payment contribution not found')
  })

  it('requires manual payout adjustments to be categorized in the same settlement', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const adjustment = balanceNode({
      id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/bt-manual-adjustment',
      type: 'ADJUSTMENT', sourceType: 'ADJUSTMENT', sourceOrderTransactionId: null,
      associatedOrder: null, transactionDate: '2026-06-02T10:00:00Z',
      amount: { amount: '0.10', currencyCode: 'EUR' },
      fee: { amount: '0.00', currencyCode: 'EUR' },
      net: { amount: '0.10', currencyCode: 'EUR' },
    })
    const fetchImpl = shopifyFetch({
      balances: [balanceNode(), adjustment],
      payouts: [{
        id: 'gid://shopify/ShopifyPaymentsPayout/9001', legacyResourceId: '9001',
        status: 'PAID', transactionType: 'DEPOSIT', issuedAt: '2026-06-03T10:00:00Z',
        externalTraceId: 'TRACE-9001', net: { amount: '35.40', currencyCode: 'EUR' },
      }],
    })
    await importShopifyOrders(pool, tenantId, importBody(product.id), seed.userA.id, fetchImpl)
    await syncShopifyPayouts(pool, tenantId, {
      fromDate: '2026-06-01', toDate: '2026-06-05', actorUserId: seed.userA.id,
    }, fetchImpl)
    const payout = (await listManualShopifyPayouts(pool, tenantId)).items[0]
    expect(payout.adjustments).toHaveLength(1)

    const missing = await settleShopifyPayoutManually(pool, tenantId, payout.id, {
      entry_date: '2026-06-04', adjustment_mappings: [],
    }, seed.userA.id)
    expect(missing.error).toMatchObject({
      status: 400, body: { code: 'shopify_payout_mapping_required' },
    })

    const settled = await settleShopifyPayoutManually(pool, tenantId, payout.id, {
      entry_date: '2026-06-04',
      adjustment_mappings: [{
        balance_transaction_id: payout.adjustments[0].id, account_code: '42000',
      }],
    }, seed.userA.id)
    expect(settled.payout.settlement_method).toBe('manual')
  })

  it('returns 404 when another tenant tries to manually settle the payout', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const fetchImpl = shopifyFetch()
    await importShopifyOrders(pool, tenantId, importBody(product.id), seed.userA.id, fetchImpl)
    await syncShopifyPayouts(pool, tenantId, {
      fromDate: '2026-06-01', toDate: '2026-06-05', actorUserId: seed.userA.id,
    }, fetchImpl)
    const payout = (await listManualShopifyPayouts(pool, tenantId)).items[0]

    await request(app)
      .post(`/api/merch/shopify/payouts/${payout.id}/settle`)
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(seed.tenantB.id))
      .send({ entry_date: '2026-06-04', adjustment_mappings: [] })
      .expect(404)
  })

  it('reviews a non-order adjustment and clears the exact payout against the bank deposit', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const adjustment = balanceNode({
      id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/bt-adjustment',
      type: 'ADJUSTMENT', sourceType: 'ADJUSTMENT', sourceOrderTransactionId: null,
      associatedOrder: null, transactionDate: '2026-06-02T10:00:00Z',
      amount: { amount: '0.10', currencyCode: 'EUR' },
      fee: { amount: '0.00', currencyCode: 'EUR' },
      net: { amount: '0.10', currencyCode: 'EUR' },
    })
    const fetchImpl = shopifyFetch({
      balances: [balanceNode(), adjustment],
      payouts: [{
        id: 'gid://shopify/ShopifyPaymentsPayout/9001', legacyResourceId: '9001',
        status: 'PAID', transactionType: 'DEPOSIT', issuedAt: '2026-06-03T10:00:00Z',
        externalTraceId: 'TRACE-9001', net: { amount: '35.40', currencyCode: 'EUR' },
      }],
    })
    expect((await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id, fetchImpl,
    )).imported).toBe(1)
    expect((await syncShopifyPayouts(pool, tenantId, {
      fromDate: '2026-06-01', toDate: '2026-06-05', actorUserId: seed.userA.id,
    }, fetchImpl)).synced).toBe(1)

    const { rows: payouts } = await pool.query(
      'SELECT * FROM shopify_payments_payouts WHERE tenant_id = $1', [tenantId],
    )
    const { rows: adjustments } = await pool.query(
      `SELECT * FROM shopify_payments_balance_transactions
        WHERE tenant_id = $1 AND processing_status = 'needs_review'`, [tenantId],
    )
    expect(payouts[0]).toMatchObject({ net_cents: 3540, sync_complete: true })
    expect(adjustments).toHaveLength(1)

    const { rows: imports } = await pool.query(
      `INSERT INTO bank_statement_imports
         (tenant_id, filename, format, currency, file_hash, created_by_user_id)
       VALUES ($1, 'shopify.xml', 'camt053', 'EUR', 'shopify-payout-test', $2)
       RETURNING *`, [tenantId, seed.userA.id],
    )
    const { rows: lines } = await pool.query(
      `INSERT INTO bank_statement_lines
         (tenant_id, import_id, line_index, booking_date, amount_cents, direction, currency)
       VALUES ($1, $2, 0, '2026-06-03', 3540, 'credit', 'EUR') RETURNING *`,
      [tenantId, imports[0].id],
    )
    const result = await commitImport(pool, tenantId, imports[0].id, [{
      lineId: lines[0].id,
      action: 'reconcile_shopify_payout',
      payoutId: payouts[0].id,
      adjustmentMappings: [{
        balanceTransactionId: adjustments[0].id, accountCode: '42000',
      }],
    }], seed.userA.id, fetchImpl)
    expect(result.results[0].status).toBe('reconciled_shopify_payout')

    const { rows: clearing } = await pool.query(
      `SELECT COALESCE(SUM(debit_cents - credit_cents), 0)::int balance
         FROM ledger_entries WHERE tenant_id = $1 AND account_code = '11300'`, [tenantId],
    )
    expect(clearing[0].balance).toBe(0)
  })

  it('posts a late refund correction and restores returned inventory at its original cost', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    expect((await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id, shopifyFetch(),
    )).imported).toBe(1)

    const refundedOrder = orderNode({
      netPaymentSet: { shopMoney: { amount: '0.00', currencyCode: 'EUR' } },
      lineItems: { nodes: [lineNode({ currentQuantity: 0 })], pageInfo: { hasNextPage: false } },
      refunds: [{
        id: 'gid://shopify/Refund/8100', createdAt: '2026-06-04T10:00:00Z',
        totalRefundedSet: { shopMoney: { amount: '36.30', currencyCode: 'EUR' } },
        transactions: { nodes: [{
          id: 'gid://shopify/OrderTransaction/8001',
          kind: 'REFUND', status: 'SUCCESS', gateway: 'shopify_payments', test: false,
        }] },
        refundLineItems: { nodes: [{
          id: 'gid://shopify/RefundLineItem/8200', quantity: 1, restocked: true,
          restockType: 'RETURN', lineItem: { id: 'gid://shopify/LineItem/5001' },
          subtotalSet: { shopMoney: { amount: '30.00', currencyCode: 'EUR' } },
          totalTaxSet: { shopMoney: { amount: '6.30', currencyCode: 'EUR' } },
        }], pageInfo: { hasNextPage: false } },
      }],
    })
    const refundBalance = balanceNode({
      id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/bt-refund',
      type: 'REFUND', sourceType: 'REFUND', sourceOrderTransactionId: '8001',
      transactionDate: '2026-06-04T10:01:00Z',
      amount: { amount: '-36.30', currencyCode: 'EUR' },
      fee: { amount: '0.00', currencyCode: 'EUR' },
      net: { amount: '-36.30', currencyCode: 'EUR' },
    })
    const refundFetch = shopifyFetch({
      orders: [refundedOrder], balances: [balanceNode(), refundBalance],
      payouts: [{
        id: 'gid://shopify/ShopifyPaymentsPayout/9001', legacyResourceId: '9001',
        status: 'PAID', transactionType: 'WITHDRAWAL', issuedAt: '2026-06-05T10:00:00Z',
        externalTraceId: 'TRACE-REFUND', net: { amount: '-1.00', currencyCode: 'EUR' },
      }],
    })
    const synced = await syncShopifyPayouts(pool, tenantId, {
      fromDate: '2026-06-04', toDate: '2026-06-06', actorUserId: seed.userA.id,
    }, refundFetch)
    expect(synced.results[0].complete).toBe(true)

    const { rows: refundRows } = await pool.query(
      `SELECT processing_status, ledger_transaction_id
         FROM shopify_payments_balance_transactions
        WHERE tenant_id = $1 AND shopify_balance_transaction_gid LIKE '%bt-refund'`, [tenantId],
    )
    expect(refundRows[0].processing_status).toBe('recorded')
    expect(refundRows[0].ledger_transaction_id).not.toBeNull()
    const stock = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(stock.body[0]).toMatchObject({ quantity_on_hand: 10, unit_cost_cents: 1200 })
    const { rows: facts } = await pool.query(
      `SELECT output_vat_cents FROM ledger_tax_facts
        WHERE tenant_id = $1 AND transaction_id = $2`,
      [tenantId, refundRows[0].ledger_transaction_id],
    )
    expect(facts[0].output_vat_cents).toBe(-630)
  })
})

describe('PayPal payout reconciliation', () => {
  it('groups PayPal orders and reports the actual deposit difference as a fee', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const orders = [
      paypalOrderNode({ orderId: 1001, lineId: 5001, transactionId: 7001, amount: '36.30' }),
      paypalOrderNode({ orderId: 1002, lineId: 5002, transactionId: 7002, amount: '20.00' }),
    ]
    const imported = await importShopifyOrders(pool, tenantId, {
      orders: [
        selectedOrder(product.id, 1001, 5001),
        selectedOrder(product.id, 1002, 5002),
      ],
    }, seed.userA.id, shopifyFetch({ orders, balances: [] }))
    expect(imported.imported).toBe(2)

    const { rows: financials } = await pool.query(
      `SELECT * FROM shopify_order_financials
        WHERE tenant_id = $1 AND payment_gateway = 'paypal' ORDER BY id`, [tenantId],
    )
    const { rows: imports } = await pool.query(
      `INSERT INTO bank_statement_imports
         (tenant_id, filename, format, currency, file_hash, created_by_user_id)
       VALUES ($1, 'paypal.xml', 'camt053', 'EUR', 'paypal-payout-test', $2)
       RETURNING *`, [tenantId, seed.userA.id],
    )
    const { rows: lines } = await pool.query(
      `INSERT INTO bank_statement_lines
         (tenant_id, import_id, line_index, booking_date, amount_cents, direction, currency)
       VALUES ($1, $2, 0, '2026-06-05', 5500, 'credit', 'EUR') RETURNING *`,
      [tenantId, imports[0].id],
    )

    const result = await commitImport(pool, tenantId, imports[0].id, [{
      lineId: lines[0].id,
      action: 'reconcile_paypal_payout',
      orderFinancialIds: financials.map((row) => row.id),
      differenceAccountCode: '64100',
    }], seed.userA.id)
    expect(result.results[0].status).toBe('reconciled_paypal_payout')

    const { rows: settlementEntries } = await pool.query(
      `SELECT le.account_code, le.debit_cents, le.credit_cents
         FROM ledger_transactions lt
         JOIN ledger_entries le ON le.transaction_id = lt.id AND le.tenant_id = lt.tenant_id
        WHERE lt.tenant_id = $1 AND lt.source_type = 'paypal_payout'
        ORDER BY le.account_code`, [tenantId],
    )
    expect(settlementEntries).toEqual([
      expect.objectContaining({ account_code: '11000', debit_cents: 5500, credit_cents: 0 }),
      expect.objectContaining({ account_code: '11400', debit_cents: 0, credit_cents: 5630 }),
      expect.objectContaining({ account_code: '64100', debit_cents: 130, credit_cents: 0 }),
    ])
    const { rows: reconciliation } = await pool.query(
      'SELECT * FROM paypal_payout_reconciliations WHERE tenant_id = $1', [tenantId],
    )
    expect(reconciliation[0]).toMatchObject({
      gross_cents: 5630, deposit_cents: 5500, difference_cents: 130,
      difference_account_code: '64100',
    })
    const { rows: clearing } = await pool.query(
      `SELECT COALESCE(SUM(debit_cents - credit_cents), 0)::int balance
         FROM ledger_entries WHERE tenant_id = $1 AND account_code = '11400'`, [tenantId],
    )
    expect(clearing[0].balance).toBe(0)
  })

  it('does not allow another tenant to reconcile PayPal orders', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 2)
    const order = paypalOrderNode({
      orderId: 1001, lineId: 5001, transactionId: 7001, amount: '36.30',
    })
    await importShopifyOrders(
      pool, tenantId, importBody(product.id), seed.userA.id,
      shopifyFetch({ orders: [order], balances: [] }),
    )
    const { rows: financials } = await pool.query(
      'SELECT id FROM shopify_order_financials WHERE tenant_id = $1', [tenantId],
    )
    const { rows: imports } = await pool.query(
      `INSERT INTO bank_statement_imports
         (tenant_id, filename, format, currency, file_hash, created_by_user_id)
       VALUES ($1, 'paypal-other.xml', 'camt053', 'EUR', 'paypal-other-tenant', $2)
       RETURNING *`, [seed.tenantB.id, seed.userB.id],
    )
    const { rows: lines } = await pool.query(
      `INSERT INTO bank_statement_lines
         (tenant_id, import_id, line_index, booking_date, amount_cents, direction, currency)
       VALUES ($1, $2, 0, '2026-06-05', 3500, 'credit', 'EUR') RETURNING *`,
      [seed.tenantB.id, imports[0].id],
    )

    const result = await commitImport(pool, seed.tenantB.id, imports[0].id, [{
      lineId: lines[0].id,
      action: 'reconcile_paypal_payout',
      orderFinancialIds: [financials[0].id],
      differenceAccountCode: '64100',
    }], seed.userB.id)

    expect(result.results[0].status).toBe('skipped_not_found')
    const { rows: reconciliations } = await pool.query(
      'SELECT * FROM paypal_payout_reconciliations WHERE tenant_id = $1', [seed.tenantB.id],
    )
    expect(reconciliations).toEqual([])
  })
})
