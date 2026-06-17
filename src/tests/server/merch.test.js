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

  it('books the gross to cash on hand (11100) when payment_method is cash', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)

    const sale = await asUserA(request(app).post('/api/merch/sales')).send({
      product_id: product.id,
      quantity: 1,
      unit_price_incl_cents: 3630,
      vat_rate: 21,
      sale_date: '2026-06-01',
      payment_method: 'cash',
    }).expect(201)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'recorded')
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['11100'].debit_cents).toBe(3630)  // cash on hand gross
    expect(byCode['11000']).toBeUndefined()         // not the bank account
    expect(byCode['42000'].credit_cents).toBe(3000) // revenue net unchanged
    expect(byCode['24000'].credit_cents).toBe(630)
    expect(byCode['51000'].debit_cents).toBe(1200)
    expect(byCode['12200'].credit_cents).toBe(1200)
  })

  it('rejects an invalid payment_method', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 5)
    const res = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, payment_method: 'paypal' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_payment_method')
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

  it('voiding a cash sale credits cash on hand (11100), not the bank', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21, payment_method: 'cash' })
      .expect(201)

    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'voided')
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['11100'].credit_cents).toBe(3630)
    expect(byCode['11000']).toBeUndefined()
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

  // The original recorded ledger entry must reflect the void, not just the
  // compensating journal — otherwise it keeps showing as a live sale.
  it('voiding an open-period sale marks the original recorded entry voided and nets reports to zero', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2, sale_date: '2026-06-01' }).expect(201)

    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)

    const { rows } = await pool.query(
      `SELECT voided_at, voided_by_transaction_id, reversed_by_transaction_id
         FROM ledger_transactions
        WHERE tenant_id = $1 AND source_type = 'merch_sale'
          AND source_id = $2 AND source_event = 'recorded'`,
      [seed.tenantA.id, sale.body.id],
    )
    expect(rows[0].voided_at).not.toBeNull()
    expect(rows[0].voided_by_transaction_id).not.toBeNull()
    expect(rows[0].reversed_by_transaction_id).toBeNull()

    // The ledger browser flags both halves voided (the default view hides them).
    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    const merch = list.body.filter((r) => r.source_type === 'merch_sale')
    expect(merch).toHaveLength(2)
    expect(merch.every((r) => r.voided)).toBe(true)

    // Both halves drop out of the financial overview → merch nets to zero.
    const overview = await asUserA(request(app).get('/api/ledger/overview')).expect(200)
    expect(overview.body.merch.revenue_cents).toBe(0)
    expect(overview.body.merch.cogs_cents).toBe(0)
  })

  it('voiding a closed-period sale posts a visible reversal and never mutates the closed period', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2, sale_date: '2026-05-15' }).expect(201)
    // Close May after recording: the sale now sits in a closed period.
    await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ books_closed_through: '2026-05-31' }).expect(200)

    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)

    // The closed-period original is left untouched, only marked reversed.
    const { rows } = await pool.query(
      `SELECT voided_at, reversed_by_transaction_id FROM ledger_transactions
        WHERE tenant_id = $1 AND source_type = 'merch_sale'
          AND source_id = $2 AND source_event = 'recorded'`,
      [seed.tenantA.id, sale.body.id],
    )
    expect(rows[0].voided_at).toBeNull()
    expect(rows[0].reversed_by_transaction_id).not.toBeNull()

    // The correction is a visible 'reversal', not a hidden 'voided' entry.
    const reversalLines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'reversal')
    expect(reversalLines.length).toBeGreaterThan(0)
    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    const reversal = list.body.find(
      (r) => r.source_type === 'merch_sale' && r.source_event === 'reversal',
    )
    expect(reversal).toBeDefined()
    expect(reversal.voided).toBe(false)
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

describe('merch — per-product revenue account', () => {
  async function saleRevenueAccount(saleId) {
    const { rows } = await pool.query(
      'SELECT revenue_account_code FROM merch_sales WHERE id = $1', [saleId],
    )
    return rows[0]?.revenue_account_code
  }

  it('accepts the merch parent itself or a descendant on create/update', async () => {
    // 42100 (Merchandise Sales - Vinyl and CDs) is a child of 42000.
    const created = await createProduct(asUserA, { revenue_account_code: '42100' })
    expect(created.revenue_account_code).toBe('42100')

    // 42000 itself is allowed.
    const toParent = await asUserA(request(app).patch(`/api/merch/products/${created.id}`))
      .send({ revenue_account_code: '42000' }).expect(200)
    expect(toParent.body.revenue_account_code).toBe('42000')

    // Clearing falls back to the band default.
    const cleared = await asUserA(request(app).patch(`/api/merch/products/${created.id}`))
      .send({ revenue_account_code: null }).expect(200)
    expect(cleared.body.revenue_account_code).toBeNull()
  })

  it('rejects a revenue account outside the merch subtree', async () => {
    // 41000 (Gig fees) is revenue but under 40000, not 42000.
    const res = await asUserA(request(app).post('/api/merch/products'))
      .send(shirtPayload({ revenue_account_code: '41000' }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('product_validation')
  })

  it('rejects an unknown account code', async () => {
    const res = await asUserA(request(app).post('/api/merch/products'))
      .send(shirtPayload({ revenue_account_code: '49999' }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('product_validation')
  })

  it('rejects when the band merch revenue account is unset', async () => {
    await pool.query(
      'UPDATE tenant_accounting_settings SET merch_revenue_account_code = NULL WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).post('/api/merch/products'))
      .send(shirtPayload({ revenue_account_code: '42100' }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('merch_revenue_account_not_configured')
  })

  it('posts revenue to the product account and snapshots it on the sale', async () => {
    const product = await createProduct(asUserA, { revenue_account_code: '42100' })
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales')).send({
      product_id: product.id, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21,
    }).expect(201)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'recorded')
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['42100'].credit_cents).toBe(3000) // product revenue account
    expect(byCode['42000']).toBeUndefined()         // not the band default
    expect(await saleRevenueAccount(sale.body.id)).toBe('42100')
  })

  it('a product with no account posts to the band default', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21 }).expect(201)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'recorded')
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['42000'].credit_cents).toBe(3000)
    expect(await saleRevenueAccount(sale.body.id)).toBeNull()
  })

  it('void reverses the snapshotted account even after the product account changes', async () => {
    const product = await createProduct(asUserA, { revenue_account_code: '42100' })
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21 }).expect(201)

    // Repoint the product to the parent after the sale.
    await asUserA(request(app).patch(`/api/merch/products/${product.id}`))
      .send({ revenue_account_code: '42000' }).expect(200)
    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)

    const lines = await ledgerLinesFor(seed.tenantA.id, 'merch_sale', sale.body.id, 'voided')
    const byCode = Object.fromEntries(lines.map((l) => [l.account_code, l]))
    expect(byCode['42100'].debit_cents).toBe(3000) // reversed to the snapshot, not 42000
    expect(byCode['42000']).toBeUndefined()
  })

  it('a code that exists only in another tenant is rejected (isolation)', async () => {
    // Tenant B gets a custom sub-account under its own 42000; tenant A has no
    // such code, so A can't reference it.
    await asUserB(request(app).post('/api/accounts')).send({
      code: '42900', name: 'B-only merch', type: 'revenue', parent_code: '42000',
    }).expect(201)

    const res = await asUserA(request(app).post('/api/merch/products'))
      .send(shirtPayload({ revenue_account_code: '42900' }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('product_validation')
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

  it('overview merch revenue includes sub-accounts under the merch revenue account', async () => {
    // One product books to the band default (42000), another to a sub-account
    // (42100 Merchandise Sales - Vinyl and CDs). Both must count as merch revenue.
    const shirt = await createProduct(asUserA)
    const vinyl = await createProduct(asUserA, { name: 'Vinyl', revenue_account_code: '42100' })
    await stockProduct(asUserA, shirt.id, 10)
    await stockProduct(asUserA, vinyl.id, 10)
    // €30 net each on both products.
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: shirt.id, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21, sale_date: '2026-06-01' }).expect(201)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: vinyl.id, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21, sale_date: '2026-06-01' }).expect(201)

    const res = await asUserA(request(app).get('/api/ledger/overview'))
      .query({ mode: 'fiscal_year', year: 2026 }).expect(200)
    // €30 (42000) + €30 (42100) = €60, not just the parent-account €30.
    expect(res.body.merch.revenue_cents).toBe(6000)
  })

  it('headline amount is the gross sale, not gross + COGS (recorded and void)', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    const sale = await asUserA(request(app).post('/api/merch/sales')).send({
      product_id: product.id, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21, sale_date: '2026-06-01',
    }).expect(201)

    const res = await asUserA(request(app).get('/api/ledger')).expect(200)
    const recorded = res.body.find(
      (r) => r.source_type === 'merch_sale' && r.source_id === sale.body.id && r.source_event === 'recorded',
    )
    // The €36.30 gross the customer paid — the €12 COGS leg must not inflate it.
    expect(recorded.amount_cents).toBe(3630)

    // The void mirror shows the same magnitude, negated — not -(gross + COGS).
    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)
    const after = await asUserA(request(app).get('/api/ledger')).expect(200)
    const voidRow = after.body.find(
      (r) => r.source_type === 'merch_sale' && r.source_id === sale.body.id && r.source_event === 'voided',
    )
    expect(voidRow.amount_cents).toBe(-3630)
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

describe('merch sales — per-product summary & period filters', () => {
  it('summarizes recorded sales per product with account code, name, qty and amount', async () => {
    const product = await createProduct(asUserA, { revenue_account_code: '42100' })
    await stockProduct(asUserA, product.id, 10)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2, unit_price_incl_cents: 3630, vat_rate: 21, sale_date: '2026-06-01' }).expect(201)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21, sale_date: '2026-06-05' }).expect(201)

    const res = await asUserA(request(app).get('/api/merch/sales/summary'))
      .query({ mode: 'fiscal_year', year: 2026 }).expect(200)
    expect(res.body).toHaveLength(1)
    const row = res.body[0]
    expect(row.product_id).toBe(product.id)
    expect(row.product_name).toBe('Band T-Shirt')
    expect(row.revenue_account_code).toBe('42100')
    expect(row.revenue_account_name).toBe('Merchandise Sales - Vinyl and CDs')
    expect(row.total_qty).toBe(3)
    expect(row.total_amount_cents).toBe(3 * 3630)
  })

  it('falls back to the band default account when the product has none', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 5)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, sale_date: '2026-06-01' }).expect(201)

    const res = await asUserA(request(app).get('/api/merch/sales/summary'))
      .query({ mode: 'fiscal_year', year: 2026 }).expect(200)
    expect(res.body[0].revenue_account_code).toBe('42000')
    expect(res.body[0].revenue_account_name).toBe('Merchandise Sales')
  })

  it('excludes voided sales from totals and omits a fully-voided product', async () => {
    const sold = await createProduct(asUserA, { name: 'Sold Out' })
    await stockProduct(asUserA, sold.id, 10)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: sold.id, quantity: 2, sale_date: '2026-06-01' }).expect(201)

    const voidedOnly = await createProduct(asUserA, { name: 'All Voided' })
    await stockProduct(asUserA, voidedOnly.id, 10)
    const v = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: voidedOnly.id, quantity: 3, sale_date: '2026-06-02' }).expect(201)
    await asUserA(request(app).post(`/api/merch/sales/${v.body.id}/void`)).expect(200)

    const res = await asUserA(request(app).get('/api/merch/sales/summary'))
      .query({ mode: 'fiscal_year', year: 2026 }).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].product_id).toBe(sold.id)
    expect(res.body[0].total_qty).toBe(2)

    // The voided rows still surface in the period-filtered detail list.
    const detail = await asUserA(request(app).get('/api/merch/sales'))
      .query({ mode: 'fiscal_year', year: 2026, product_id: voidedOnly.id }).expect(200)
    expect(detail.body).toHaveLength(1)
    expect(detail.body[0].status).toBe('voided')
  })

  it('summary is scoped to the active tenant', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 5)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, sale_date: '2026-06-01' }).expect(201)

    const res = await asUserB(request(app).get('/api/merch/sales/summary'))
      .query({ mode: 'fiscal_year', year: 2026 }).expect(200)
    expect(res.body).toHaveLength(0)
  })

  it('respects the period filter', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, sale_date: '2025-06-01' }).expect(201)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 2, sale_date: '2026-06-01' }).expect(201)

    const res = await asUserA(request(app).get('/api/merch/sales/summary'))
      .query({ mode: 'fiscal_year', year: 2026 }).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].total_qty).toBe(2)
  })

  it('periods lists only dates with a recorded sale', async () => {
    const product = await createProduct(asUserA)
    await stockProduct(asUserA, product.id, 10)
    await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, sale_date: '2026-06-01' }).expect(201)
    const v = await asUserA(request(app).post('/api/merch/sales'))
      .send({ product_id: product.id, quantity: 1, sale_date: '2026-07-01' }).expect(201)
    await asUserA(request(app).post(`/api/merch/sales/${v.body.id}/void`)).expect(200)

    const res = await asUserA(request(app).get('/api/merch/sales/periods')).expect(200)
    expect(res.body).toContain('2026-06-01')
    expect(res.body).not.toContain('2026-07-01')
  })

  it('rejects a malformed product_id and a malformed period with 400', async () => {
    await asUserA(request(app).get('/api/merch/sales')).query({ product_id: 'abc' }).expect(400)
    await asUserA(request(app).get('/api/merch/sales/summary'))
      .query({ mode: 'fiscal_year', year: 'nope' }).expect(400)
  })
})
