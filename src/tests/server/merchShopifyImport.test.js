import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let importShopifyOrders, fetchRecentOrders, resetShopifyTokenCacheForTests
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const importMod = await import('../../../server/services/merchShopifyService.js')
  const shopMod = await import('../../../server/services/shopifyService.js')
  const tokenMod = await import('../../../server/services/shopifyTokenService.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  importShopifyOrders = importMod.importShopifyOrders
  fetchRecentOrders = shopMod.fetchRecentOrders
  resetShopifyTokenCacheForTests = tokenMod.resetShopifyTokenCacheForTests
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  // tenant ids reset with the schema (RESTART IDENTITY), so clear cached tokens.
  resetShopifyTokenCacheForTests()
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))
}

// ---------- shopify fetch fakes ----------

function jsonResponse(body, { status = 200, link = null, retryAfter = null } = {}) {
  const headers = {
    get: (name) => {
      const n = String(name).toLowerCase()
      if (n === 'link') return link
      if (n === 'retry-after') return retryAfter
      return null
    },
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers,
  }
}

// Records calls; `handler(url, opts, callIndex)` returns a fake Response.
function fakeFetch(handler) {
  const calls = []
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts })
    return handler(String(url), opts, calls.length)
  }
  fn.calls = calls
  return fn
}

const TOKEN_BODY = { access_token: 'shptest-token', scope: 'read_orders', expires_in: 86399 }
const isTokenUrl = (url) => url.includes('/admin/oauth/access_token')

// Combined fake: the client_credentials token endpoint returns an access token;
// the orders endpoint returns the canned orders (with opts for link/status).
function ordersResponse(orders, opts) {
  return fakeFetch((url) => (isTokenUrl(url) ? jsonResponse(TOKEN_BODY) : jsonResponse({ orders }, opts)))
}

// ---------- order/line builders ----------

function lineItem(overrides = {}) {
  return {
    id: 5001,
    title: 'Band T-Shirt',
    sku: 'TS',
    quantity: 1,
    current_quantity: 1,
    price: '36.30',
    total_discount: '0.00',
    discount_allocations: [],
    ...overrides,
  }
}

function order(overrides = {}) {
  return {
    id: 1001,
    name: '#1001',
    created_at: '2026-06-01T10:00:00Z',
    processed_at: '2026-06-01T10:00:00Z',
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    cancelled_at: null,
    currency: 'EUR',
    taxes_included: true,
    current_total_price: '36.30',
    line_items: [lineItem()],
    ...overrides,
  }
}

// ---------- DB helpers ----------

async function configureShopify(tenantId) {
  await pool.query(
    'UPDATE tenants SET shopify_client_id = $1, shopify_client_secret = $2, shopify_shop_domain = $3 WHERE id = $4',
    ['a'.repeat(32), 'b'.repeat(32), 'test-band.myshopify.com', tenantId],
  )
}

async function createProduct(overrides = {}) {
  const res = await asUserA(request(app).post('/api/merch/products')).send({
    name: 'Band T-Shirt', unit_cost_cents: 1200, default_price_incl_cents: 3630, vat_rate: 21, ...overrides,
  }).expect(201)
  return res.body
}

async function stockProduct(productId, quantity, unitCostCents = 1200) {
  await asUserA(request(app).post('/api/purchases')).send({
    supplier_name: 'Merch Printer',
    receipt_date: '2026-05-01',
    status: 'approved',
    lines: [{
      description: 'batch', tax_rate: 21,
      amount_incl_cents: Math.round(quantity * unitCostCents * 1.21),
      product_id: productId, quantity,
    }],
  }).expect(201)
}

async function ledgerLinesByTxn(txnId) {
  const { rows } = await pool.query(
    'SELECT account_code, debit_cents, credit_cents FROM ledger_entries WHERE transaction_id = $1 ORDER BY id',
    [txnId],
  )
  return rows
}

async function importRow(tenantId, lineId) {
  const { rows } = await pool.query(
    'SELECT * FROM shopify_order_imports WHERE tenant_id = $1 AND shopify_line_id = $2',
    [tenantId, String(lineId)],
  )
  return rows[0] || null
}

async function ledgerLinesForSale(tenantId, saleId, event = 'recorded') {
  const { rows } = await pool.query(
    `SELECT le.account_code, le.debit_cents, le.credit_cents
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
      WHERE lt.tenant_id = $1 AND lt.source_type = 'merch_sale' AND lt.source_id = $2 AND lt.source_event = $3
      ORDER BY le.id`,
    [tenantId, saleId, event],
  )
  return rows
}

async function pickRevenueAccount(tenantId) {
  const { rows } = await pool.query(
    `SELECT code FROM chart_of_accounts
      WHERE tenant_id = $1 AND type = 'revenue' AND is_active = true AND code <> '42000'
      ORDER BY code LIMIT 1`,
    [tenantId],
  )
  return rows[0].code
}

const byCode = (lines) => Object.fromEntries(lines.map((l) => [l.account_code, l]))

// ---------- tests ----------

describe('shopify import — product lines', () => {
  it('imports a product line as a merch sale: 5-line journal, stock decrement, tracking row', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)

    const result = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5001, mapping: { type: 'product', product_id: product.id } }] }] },
      seed.userA.id,
      ordersResponse([order()]),
    )
    expect(result.imported).toBe(1)

    const imp = await importRow(tenantId, 5001)
    expect(imp.kind).toBe('product')
    expect(imp.merch_sale_id).not.toBeNull()

    const lines = byCode(await ledgerLinesForSale(tenantId, imp.merch_sale_id))
    expect(lines['11000'].debit_cents).toBe(3630)  // bank gross
    expect(lines['42000'].credit_cents).toBe(3000) // revenue net
    expect(lines['24000'].credit_cents).toBe(630)  // output VAT
    expect(lines['51000'].debit_cents).toBe(1200)  // COGS
    expect(lines['12200'].credit_cents).toBe(1200) // inventory relief

    const stock = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(stock.body[0].quantity_on_hand).toBe(9)
  })

  it('posts the exact discounted/refund-adjusted gross via gross_incl_cents (not round(unit)×qty)', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)

    // €10 ex-VAT unit × 3, taxes excluded, €10 line discount.
    // Subtotal = 1000*3 − 1000 = 2000 (ex-VAT); +21% VAT = 2420.
    // 2420 is not divisible by 3, so a per-unit price can't represent it.
    const li = lineItem({
      quantity: 3, current_quantity: 3, price: '10.00',
      discount_allocations: [{ amount: '10.00' }],
    })
    const result = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5001, mapping: { type: 'product', product_id: product.id } }] }] },
      seed.userA.id,
      ordersResponse([order({ taxes_included: false, line_items: [li] })]),
    )
    expect(result.imported).toBe(1)

    const imp = await importRow(tenantId, 5001)
    const lines = byCode(await ledgerLinesForSale(tenantId, imp.merch_sale_id))
    expect(lines['11000'].debit_cents).toBe(2420)   // exact gross (VAT added because taxes excluded)
    expect(lines['42000'].credit_cents).toBe(2000)  // net
    expect(lines['24000'].credit_cents).toBe(420)   // VAT

    // gross_incl_cents stored exactly; unit price is the rounded display value.
    const { rows } = await pool.query('SELECT quantity, unit_price_incl_cents, gross_incl_cents FROM merch_sales WHERE id = $1', [imp.merch_sale_id])
    expect(rows[0].quantity).toBe(3)
    expect(rows[0].gross_incl_cents).toBe(2420)
    expect(rows[0].quantity * rows[0].unit_price_incl_cents).not.toBe(2420)
  })

  it('skips an insufficient-stock line but imports the rest', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 1)
    const revAcct = await pickRevenueAccount(tenantId)

    const li1 = lineItem({ id: 5001, quantity: 3, current_quantity: 3 })
    const li2 = lineItem({ id: 5002, title: 'Shipping', price: '5.00', current_quantity: 1, quantity: 1 })
    const result = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [
        { shopify_line_id: 5001, mapping: { type: 'product', product_id: product.id } },
        { shopify_line_id: 5002, mapping: { type: 'revenue', account_code: revAcct, vat_rate: 21 } },
      ] }] },
      seed.userA.id,
      ordersResponse([order({ line_items: [li1, li2] })]),
    )
    const status = Object.fromEntries(result.results.map((r) => [r.shopify_line_id, r.status]))
    expect(status['5001']).toBe('skipped_insufficient_stock')
    expect(status['5002']).toBe('imported')
    expect(await importRow(tenantId, 5001)).toBeNull()
  })
})

describe('shopify import — revenue-only lines', () => {
  it('posts a revenue-only journal with no inventory/COGS', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const revAcct = await pickRevenueAccount(tenantId)

    const li = lineItem({ id: 5005, title: 'Shipping', price: '12.10' })
    const result = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5005, mapping: { type: 'revenue', account_code: revAcct, vat_rate: 21 } }] }] },
      seed.userA.id,
      ordersResponse([order({ line_items: [li] })]),
    )
    expect(result.imported).toBe(1)

    const imp = await importRow(tenantId, 5005)
    expect(imp.kind).toBe('revenue')
    expect(imp.ledger_transaction_id).not.toBeNull()

    const lines = byCode(await ledgerLinesByTxn(imp.ledger_transaction_id))
    expect(lines['11000'].debit_cents).toBe(1210)
    expect(lines[revAcct].credit_cents).toBe(1000)
    expect(lines['24000'].credit_cents).toBe(210)
    expect(lines['51000']).toBeUndefined()  // no COGS
    expect(lines['12200']).toBeUndefined()  // no inventory

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM merch_sales WHERE tenant_id = $1', [tenantId])
    expect(rows[0].n).toBe(0)
  })

  it('rejects a revenue line mapped to a non-revenue / unknown account', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const li = lineItem({ id: 5006, price: '12.10' })
    const result = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5006, mapping: { type: 'revenue', account_code: '11000', vat_rate: 21 } }] }] },
      seed.userA.id,
      ordersResponse([order({ line_items: [li] })]),
    )
    expect(result.results[0].status).toBe('skipped_invalid_account')
  })
})

describe('shopify import — eligibility', () => {
  const cases = [
    ['cancelled', { cancelled_at: '2026-06-02T00:00:00Z' }, 'skipped_cancelled'],
    ['non-EUR', { currency: 'USD' }, 'skipped_unsupported_currency'],
    ['unpaid', { financial_status: 'pending' }, 'skipped_unpaid'],
  ]
  for (const [label, overrides, expected] of cases) {
    it(`skips ${label} orders and posts nothing`, async () => {
      const tenantId = seed.tenantA.id
      await configureShopify(tenantId)
      const product = await createProduct()
      await stockProduct(product.id, 10)

      const result = await importShopifyOrders(
        pool, tenantId,
        { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5001, mapping: { type: 'product', product_id: product.id } }] }] },
        seed.userA.id,
        ordersResponse([order(overrides)]),
      )
      expect(result.results[0].status).toBe(expected)
      expect(await importRow(tenantId, 5001)).toBeNull()
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM merch_sales WHERE tenant_id = $1', [tenantId])
      expect(rows[0].n).toBe(0)
    })
  }

  it('skips a fully-refunded line (current_quantity 0)', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const li = lineItem({ quantity: 2, current_quantity: 0 })
    const result = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5001, mapping: { type: 'product', product_id: product.id } }] }] },
      seed.userA.id,
      ordersResponse([order({ line_items: [li] })]),
    )
    expect(result.results[0].status).toBe('skipped_refunded_line')
  })
})

describe('shopify import — idempotency & period close', () => {
  it('re-importing the same line is a no-op; an untracked line in the order still imports', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    const revAcct = await pickRevenueAccount(tenantId)
    const fetchImpl = ordersResponse([order({ line_items: [lineItem({ id: 5001 }), lineItem({ id: 5002, title: 'Tote', price: '12.10' })] })])

    const body = { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5001, mapping: { type: 'product', product_id: product.id } }] }] }
    const first = await importShopifyOrders(pool, tenantId, body, seed.userA.id, fetchImpl)
    expect(first.imported).toBe(1)

    // Re-run the same line (duplicate) plus a new, untracked revenue line.
    const second = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [
        { shopify_line_id: 5001, mapping: { type: 'product', product_id: product.id } },
        { shopify_line_id: 5002, mapping: { type: 'revenue', account_code: revAcct, vat_rate: 21 } },
      ] }] },
      seed.userA.id, fetchImpl,
    )
    const status = Object.fromEntries(second.results.map((r) => [r.shopify_line_id, r.status]))
    expect(status['5001']).toBe('skipped_duplicate')
    expect(status['5002']).toBe('imported')

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM merch_sales WHERE tenant_id = $1', [tenantId])
    expect(rows[0].n).toBe(1) // only the single product sale, never duplicated
  })

  it('skips a line whose order date falls in a closed period', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const product = await createProduct()
    await stockProduct(product.id, 10)
    await pool.query('UPDATE tenant_accounting_settings SET books_closed_through = $1 WHERE tenant_id = $2', ['2026-12-31', tenantId])

    const result = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5001, mapping: { type: 'product', product_id: product.id } }] }] },
      seed.userA.id,
      ordersResponse([order()]),
    )
    expect(result.results[0].status).toBe('skipped_closed_period')
    expect(await importRow(tenantId, 5001)).toBeNull()
  })
})

describe('shopify import — tenant isolation', () => {
  it("cannot map a line to another tenant's product", async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    // Product belongs to tenant B.
    const resB = await request(app).post('/api/merch/products')
      .set('x-test-user-id', String(seed.userB.id)).set('x-test-tenant-id', String(seed.tenantB.id))
      .send({ name: 'B shirt', unit_cost_cents: 1200, default_price_incl_cents: 3630, vat_rate: 21 }).expect(201)

    const result = await importShopifyOrders(
      pool, tenantId,
      { orders: [{ shopify_order_id: 1001, lines: [{ shopify_line_id: 5001, mapping: { type: 'product', product_id: resB.body.id } }] }] },
      seed.userA.id,
      ordersResponse([order()]),
    )
    expect(result.results[0].status).toBe('skipped_invalid_mapping')
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM merch_sales WHERE tenant_id = $1', [tenantId])
    expect(rows[0].n).toBe(0)
  })
})

describe('shopify fetch — orders listing', () => {
  it('maps the slim DTO, parses the next cursor, and flags imported/fully-imported', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    // Pre-mark line 5001 as already imported.
    await pool.query(
      `INSERT INTO shopify_order_imports (tenant_id, shopify_order_id, shopify_line_id, kind) VALUES ($1, '1001', '5001', 'product')`,
      [tenantId],
    )
    const link = '<https://test-band.myshopify.com/admin/api/2026-01/orders.json?limit=50&page_info=NEXTCURSOR>; rel="next"'
    const fetchImpl = ordersResponse([order({ line_items: [lineItem({ id: 5001 })] })], { link })

    const res = await fetchRecentOrders(pool, tenantId, {}, fetchImpl)
    expect(res.nextCursor).toBe('NEXTCURSOR')
    expect(res.orders[0].id).toBe('1001')
    expect(res.orders[0].line_items[0].current_quantity).toBe(1)
    expect(res.orders[0].line_items[0].already_imported).toBe(true)
    expect(res.orders[0].fully_imported).toBe(true)
  })

  it('sends status=any only on the first page, page_info-only on subsequent pages', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const fetchImpl = ordersResponse([order()])

    await fetchRecentOrders(pool, tenantId, {}, fetchImpl)
    await fetchRecentOrders(pool, tenantId, { cursor: 'ABC' }, fetchImpl)

    // Ignore the token-mint call(s); assert on the Admin API order requests.
    const orderCalls = fetchImpl.calls.filter((c) => c.url.includes('/orders.json'))
    expect(orderCalls[0].url).toContain('status=any')
    expect(orderCalls[1].url).toContain('page_info=ABC')
    expect(orderCalls[1].url).not.toContain('status=any')
  })

  it('maps a 429 to shopify_rate_limited with retry_after', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    // Token mint succeeds; the orders request is throttled.
    const fetchImpl = fakeFetch((url) => (isTokenUrl(url)
      ? jsonResponse(TOKEN_BODY)
      : jsonResponse({}, { status: 429, retryAfter: '7' })))

    const res = await fetchRecentOrders(pool, tenantId, {}, fetchImpl)
    expect(res.error.status).toBe(429)
    expect(res.error.body.error).toBe('shopify_rate_limited')
    expect(res.error.body.retry_after).toBe(7)
  })

  it('surfaces a token-endpoint failure as shopify_auth_failed with the Shopify code/message (never 401)', async () => {
    const tenantId = seed.tenantA.id
    await configureShopify(tenantId)
    const fetchImpl = fakeFetch(() => jsonResponse(
      { error: 'app_not_installed', error_description: 'The application is not installed on this shop.' },
      { status: 400 },
    ))

    const res = await fetchRecentOrders(pool, tenantId, {}, fetchImpl)
    // Not 401 — that would trip the SPA's session-expiry logout.
    expect(res.error.status).toBe(400)
    expect(res.error.body.error).toBe('shopify_auth_failed')
    expect(res.error.body.code).toBe('app_not_installed')
    expect(res.error.body.message).toMatch(/not installed/i)
  })

  it('returns shopify_not_configured (and the route 400s) when creds are missing', async () => {
    const res = await asUserA(request(app).get('/api/merch/shopify/orders')).expect(400)
    expect(res.body.error).toBe('shopify_not_configured')
  })
})
