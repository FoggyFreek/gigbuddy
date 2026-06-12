import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

function asUserB(req) {
  return req
    .set('x-test-user-id', String(seed.userB.id))
    .set('x-test-tenant-id', String(seed.tenantB.id))
}

// The €36.30 t-shirt: €30 net + €6.30 VAT (21%), €12 cost.
function shirtPayload(overrides = {}) {
  return {
    name: 'Band T-Shirt',
    unit_cost_cents: 1200,
    default_price_incl_cents: 3630,
    vat_rate: 21,
    ...overrides,
  }
}

async function createProduct(asUser, overrides = {}) {
  const res = await asUser(request(app).post('/api/merch/products')).send(shirtPayload(overrides)).expect(201)
  return res.body
}

// Stock products via an approved purchase (the only stock-in path).
// unitCostCents is the intended NET cost per unit; the line is entered gross
// (incl. 21% VAT) so the booked net — and thus the moving average — lands on it.
async function stockProduct(asUser, productId, quantity, unitCostCents = 1200) {
  await asUser(request(app).post('/api/purchases')).send({
    supplier_name: 'Merch Printer',
    receipt_date: '2026-05-01',
    status: 'approved',
    lines: [
      {
        description: 'T-shirt batch',
        tax_rate: 21,
        amount_incl_cents: Math.round(quantity * unitCostCents * 1.21),
        product_id: productId,
        quantity,
      },
    ],
  }).expect(201)
}

async function ledgerLinesFor(tenantId, sourceType, sourceId, sourceEvent) {
  const { rows } = await pool.query(
    `SELECT le.account_code, le.debit_cents, le.credit_cents
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
      WHERE lt.tenant_id = $1 AND lt.source_type = $2 AND lt.source_id = $3 AND lt.source_event = $4
      ORDER BY le.id`,
    [tenantId, sourceType, sourceId, sourceEvent],
  )
  return rows
}

describe('merch products — CRUD & validation', () => {
  it('creates and lists a product', async () => {
    const product = await createProduct(asUserA)
    expect(product.name).toBe('Band T-Shirt')
    expect(product.unit_cost_cents).toBe(1200)
    expect(product.quantity_on_hand).toBe(0)

    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body).toHaveLength(1)
  })

  it('rejects an invalid VAT rate and negative cost', async () => {
    const badVat = await asUserA(request(app).post('/api/merch/products')).send(shirtPayload({ vat_rate: 19 }))
    expect(badVat.status).toBe(400)
    const badCost = await asUserA(request(app).post('/api/merch/products')).send(shirtPayload({ unit_cost_cents: -5 }))
    expect(badCost.status).toBe(400)
  })

  it('updates a product', async () => {
    const product = await createProduct(asUserA)
    const res = await asUserA(request(app).patch(`/api/merch/products/${product.id}`))
      .send({ unit_cost_cents: 1500 }).expect(200)
    expect(res.body.unit_cost_cents).toBe(1500)
  })

  it('archives instead of deleting', async () => {
    const product = await createProduct(asUserA)
    const res = await asUserA(request(app).delete(`/api/merch/products/${product.id}`)).expect(200)
    expect(res.body.archived_at).not.toBeNull()
    // Archiving again 404s (already archived).
    await asUserA(request(app).delete(`/api/merch/products/${product.id}`)).expect(404)
  })
})

describe('merch — tenant isolation', () => {
  it('list returns only the active tenant', async () => {
    await createProduct(asUserA)
    await createProduct(asUserB, { name: 'Beta Cap' })
    const a = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(a.body).toHaveLength(1)
    expect(a.body[0].name).toBe('Band T-Shirt')
  })

  it('cross-tenant product patch/archive return 404', async () => {
    const product = await createProduct(asUserA)
    await asUserB(request(app).patch(`/api/merch/products/${product.id}`)).send({ name: 'X' }).expect(404)
    await asUserB(request(app).delete(`/api/merch/products/${product.id}`)).expect(404)
  })

  it('cannot record a sale against another tenant\'s product', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const res = await asUserB(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1 })
    expect(res.status).toBe(400)
  })

  it('cannot link a sale to another tenant\'s gig', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const res = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, gig_id: seed.gigB.id })
    expect(res.status).toBe(400)
  })

  it('cannot void another tenant\'s sale', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1 }).expect(201)
    await asUserB(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(404)
  })

  it('cross-tenant product_id on a purchase line is rejected', async () => {
    const product = await createProduct(asUserA)
    const res = await asUserB(request(app).post('/api/purchases')).send({
      supplier_name: 'Printer',
      lines: [{ description: 'shirts', tax_rate: 21, amount_incl_cents: 1000, product_id: product.id, quantity: 5 }],
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_product_id')
  })
})

describe('merch — purchase stock-in', () => {
  it('approving a purchase with a product line adds stock and books to the inventory account', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10, 1200)

    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(10)

    const { rows: purchases } = await pool.query(
      'SELECT id FROM purchases WHERE tenant_id = $1', [seed.tenantA.id],
    )
    const lines = await ledgerLinesFor(seed.tenantA.id, 'purchase', purchases[0].id, 'accrued')
    // 10 units @ €12 net (€145.20 gross @ 21%) books €120 net to inventory 12200.
    const inventoryLine = lines.find((l) => l.account_code === '12200')
    expect(inventoryLine).toBeTruthy()
    expect(inventoryLine.debit_cents).toBe(12000)
    expect(lines.find((l) => l.account_code === '61200')).toBeUndefined()
  })

  it('draft purchases add no stock; stock lands on approval', async () => {
    const product = await createProduct(asUserA)
    const created = await asUserA(request(app).post('/api/purchases')).send({
      supplier_name: 'Printer',
      lines: [{ description: 'shirts', tax_rate: 21, amount_incl_cents: 12000, product_id: product.id, quantity: 10 }],
    }).expect(201)

    let list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(0)

    await asUserA(request(app).patch(`/api/purchases/${created.body.id}`)).send({ status: 'approved' }).expect(200)
    list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(10)
  })

  it('re-averages the unit cost across purchases at different prices', async () => {
    const product = await createProduct(asUserA, { unit_cost_cents: 0 })
    // 10 units @ €10 net, then 20 units @ €13 net:
    // (10 × 1000 + 20 × 1300) / 30 = €12.00 average.
    await stockProduct(asUserA, product.id, 10, 1000)
    await stockProduct(asUserA, product.id, 20, 1300)

    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(30)
    expect(list.body[0].unit_cost_cents).toBe(1200)

    // A sale now relieves inventory at the current average.
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2 }).expect(201)
    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'recorded')
    const cogs = lines.find((l) => l.account_code === '51000')
    expect(cogs.debit_cents).toBe(2400)
  })

  it('voiding a sale re-absorbs the units at their snapshot cost', async () => {
    const product = await createProduct(asUserA, { unit_cost_cents: 0 })
    await stockProduct(asUserA, product.id, 10, 1000)
    // Sale snapshots €10; afterwards a pricier batch raises the average:
    // (8 × 1000 + 20 × 1300) / 28 = €12.14.
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2 }).expect(201)
    await stockProduct(asUserA, product.id, 20, 1300)

    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)

    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(30)
    // (28 × 1214 + 2 × 1000) / 30 = 1200 (rounded per step).
    expect(list.body[0].unit_cost_cents).toBe(Math.round((28 * 1214 + 2 * 1000) / 30))
  })

  it('product line without quantity is rejected', async () => {
    const product = await createProduct(asUserA)
    const res = await asUserA(request(app).post('/api/purchases')).send({
      supplier_name: 'Printer',
      lines: [{ description: 'shirts', tax_rate: 21, amount_incl_cents: 1000, product_id: product.id }],
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('product_quantity_required')
  })
})

describe('merch sales — posting', () => {
  it('records the €36.30 t-shirt sale with the expected journal lines', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)

    const sale = await asUserA(request(app).post('/api/merch/sales')).send({
      product_id: product.id,
      quantity: 1,
      unit_price_incl_cents: 3630,
      vat_rate: 21,
      sale_date: '2026-06-01',
    }).expect(201)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'recorded')
    expect(lines).toHaveLength(5)
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['11000'].debit_cents).toBe(3630)  // checking gross
    expect(byCode['42000'].credit_cents).toBe(3000) // revenue net
    expect(byCode['24000'].credit_cents).toBe(630)  // output VAT
    expect(byCode['51000'].debit_cents).toBe(1200)  // COGS
    expect(byCode['12200'].credit_cents).toBe(1200) // inventory relief

    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(9)
  })

  it('defaults price and VAT from the product', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 5)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2 }).expect(201)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'recorded')
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['11000'].debit_cents).toBe(7260)
    expect(byCode['42000'].credit_cents).toBe(6000)
  })

  it('insufficient stock → 409, no ledger row, stock unchanged', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 2)

    const res = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 3 })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('insufficient_stock')
    expect(res.body.available).toBe(2)

    const { rows } = await pool.query(
      `SELECT 1 FROM ledger_transactions WHERE tenant_id = $1 AND source_type = 'merch_sale'`,
      [seed.tenantA.id],
    )
    expect(rows).toHaveLength(0)
    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(2)
  })

  it('rejects a sale on an archived product', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 5)
    await asUserA(request(app).delete(`/api/merch/products/${product.id}`)).expect(200)
    const res = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1 })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('product_archived')
  })

  it('sale dated in a closed period → 409 period_closed, fully rolled back', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 5)
    await pool.query(
      `UPDATE tenant_accounting_settings SET books_closed_through = '2026-06-30' WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, sale_date: '2026-06-15' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('period_closed')

    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(5)
    const { rows } = await pool.query(
      'SELECT 1 FROM merch_sales WHERE tenant_id = $1', [seed.tenantA.id],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('merch sales — void', () => {
  it('voiding posts the mirror journal and restores stock; second void → 409', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2, unit_price_incl_cents: 3630, vat_rate: 21 }).expect(201)

    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'voided')
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['11000'].credit_cents).toBe(7260)
    expect(byCode['42000'].debit_cents).toBe(6000)
    expect(byCode['24000'].debit_cents).toBe(1260)
    expect(byCode['51000'].credit_cents).toBe(2400)
    expect(byCode['12200'].debit_cents).toBe(2400)

    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(10)

    const again = await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`))
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('already_voided')
  })

  it('void reverses the snapshotted cost even after the product cost changes', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 5)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1 }).expect(201)

    await asUserA(request(app).patch(`/api/merch/products/${product.id}`))
      .send({ unit_cost_cents: 9999 }).expect(200)
    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'voided')
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['51000'].credit_cents).toBe(1200)
  })
})

describe('merch — accounting settings', () => {
  it('missing merch revenue account → 409 accounting_not_configured, rolled back', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 5)
    await pool.query(
      'UPDATE tenant_accounting_settings SET merch_revenue_account_code = NULL WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1 })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('accounting_not_configured')

    const list = await asUserA(request(app).get('/api/merch/products')).expect(200)
    expect(list.body[0].quantity_on_hand).toBe(5)
  })

  it('settings are seeded with the merch account defaults', async () => {
    const res = await asUserA(request(app).get('/api/accounts/settings')).expect(200)
    expect(res.body.merch_inventory_account_code).toBe('12200')
    expect(res.body.merch_revenue_account_code).toBe('42000')
    expect(res.body.merch_cogs_account_code).toBe('51000')
  })

  it('an account referenced by merch settings cannot be deactivated', async () => {
    const { rows } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '42000'`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).patch(`/api/accounts/${rows[0].id}`))
      .send({ is_active: false })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('account_in_use')
  })
})

describe('merch sales — list & ledger browser', () => {
  it('lists sales with product name, newest first', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, sale_date: '2026-06-01' }).expect(201)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2, sale_date: '2026-06-05' }).expect(201)

    const res = await asUserA(request(app).get('/api/merch/sales')).expect(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].sale_date).toBe('2026-06-05')
    expect(res.body[0].product_name).toBe('Band T-Shirt')
    expect(res.body[0].quantity).toBe(2)
  })

  it('reports merch contribution and inventory value in the financial overview', async () => {
    const product = await createProduct(asUserA)
    // 10 shirts @ €12 net each: inventory in at the actual net of the bill.
    await stockProduct(asUserA, product.id, 10, 1200)
    // Two shirts sold at €36.30 incl: €60 revenue net, €24 COGS.
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2, sale_date: '2026-06-01' }).expect(201)

    const res = await asUserA(request(app).get('/api/ledger/overview'))
      .query({ mode: 'fiscal_year', year: 2026 }).expect(200)
    expect(res.body.merch.revenue_cents).toBe(6000)
    expect(res.body.merch.cogs_cents).toBe(2400)
    expect(res.body.merch.gross_profit_cents).toBe(3600)
    // €120 in (purchase net) − €24 out (COGS) = €96 on hand.
    expect(res.body.merch.inventory_value_cents).toBe(12000 - 2400)
    // Merch counts toward the overall result totals too.
    expect(res.body.totals.revenue_cents).toBe(6000)
    expect(res.body.totals.expense_cents).toBe(2400)
  })

  it('classifies and describes merch sales in the ledger browser', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 3, sale_date: '2026-06-01' }).expect(201)

    const res = await asUserA(request(app).get('/api/ledger')).expect(200)
    const row = res.body.find((r) => r.source_type === 'merch_sale' && r.source_id === sale.body.id)
    expect(row).toBeTruthy()
    expect(row.type).toBe('Merch sale')
    expect(row.group).toBe('invoices')
    expect(row.description).toBe('Merch sale: 3 × Band T-Shirt')
  })
})
