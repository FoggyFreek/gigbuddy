import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

// Stub MinIO so the invoice PDF render path is a no-op (we assert API output).
vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async () => ({ etag: 'test' })),
    getObject: vi.fn(async () => { throw new Error('no such key') }),
    statObject: vi.fn(async () => ({ size: 0, metaData: {} })),
    removeObject: vi.fn(async () => undefined),
  },
}))

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
  return req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))
}
function asUserB(req) {
  return req.set('x-test-user-id', String(seed.userB.id)).set('x-test-tenant-id', String(seed.tenantB.id))
}

const YEAR = 2026

// ---------- payload builders / drivers ----------

function invoicePayload(overrides = {}) {
  return {
    customer_name: 'Texel Buitengewoon',
    issue_date: `${YEAR}-02-10`,
    payment_term_days: 14,
    tax_inclusive: false,
    discount_cents: 0,
    lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 100000, tax_percentage: 21 }],
    ...overrides,
  }
}

async function createSentInvoice(overrides = {}, as = asUserA) {
  const r = await as(request(app).post('/api/invoices')).send(invoicePayload(overrides)).expect(201)
  await as(request(app).patch(`/api/invoices/${r.body.id}`)).send({ status: 'sent' }).expect(200)
  return r.body
}

// Accrued purchase: gross 2500 at 21% → net 2066, VAT 434.
async function createAccruedPurchase(as = asUserA) {
  const r = await as(request(app).post('/api/purchases')).send({
    supplier_name: 'mi5 Studios',
    receipt_date: `${YEAR}-02-15`,
    memo: 'TEST',
    status: 'approved',
    lines: [
      { description: 'Studio day', account_code: '62100', tax_rate: 21, amount_incl_cents: 2500 },
    ],
  }).expect(201)
  return r.body
}

const sum = (rows) => rows.reduce((a, r) => a + r.amount_cents, 0)

// ============================================================
describe('financial report', () => {
  it('builds P&L, balance sheet, VAT and trial balance for a period', async () => {
    await createSentInvoice() // revenue 100000 net, output VAT 21000, receivable 121000
    await createAccruedPurchase() // expense 2066 net, input VAT 434, payable 2500

    const res = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'fiscal_year', year: YEAR }),
    ).expect(200)

    const { profit_loss, balance_sheet, vat, trial_balance } = res.body
    expect(res.body.currency).toBe('EUR')
    expect(res.body.period).toEqual({ from: `${YEAR}-01-01`, to: `${YEAR}-12-31` })

    // P&L
    expect(sum(profit_loss.revenue)).toBe(100000)
    expect(sum(profit_loss.expenses)).toBe(2066)
    expect(profit_loss.totals).toEqual({
      revenue_cents: 100000,
      cogs_cents: 0,
      gross_profit_cents: 100000,
      expense_cents: 2066,
      result_cents: 97934,
    })
    const expenseRow = profit_loss.expenses.find((r) => r.code === '62100')
    expect(expenseRow).toMatchObject({ amount_cents: 2066 })

    // Balance sheet: receivable asset, payable + output VAT liabilities,
    // input VAT asset; balances via the unallocated result line.
    expect(balance_sheet.as_of).toBe(`${YEAR}-12-31`)
    expect(balance_sheet.totals.assets_cents).toBe(121000 + 434)
    expect(balance_sheet.totals.liabilities_cents).toBe(21000 + 2500)
    expect(balance_sheet.unallocated_result_cents).toBe(97934)
    expect(balance_sheet.totals.liabilities_and_equity_cents)
      .toBe(balance_sheet.totals.assets_cents)

    // VAT — figures plus declaration/period-close status (nothing filed yet)
    expect(vat).toEqual({
      output_cents: 21000,
      input_cents: 434,
      net_cents: 20566,
      books_closed_through: null,
      books_closed: false,
      period_to: `${YEAR}-12-31`,
      returns: [],
    })

    // Trial balance always balances
    expect(trial_balance.totals.debit_cents).toBe(trial_balance.totals.credit_cents)
    expect(trial_balance.rows.length).toBeGreaterThan(0)
  })

  it('reports the VAT declaration status and closed period once a quarter is filed', async () => {
    await createSentInvoice() // Q1 activity: output VAT 21000
    await createAccruedPurchase() // Q1 activity: input VAT 434

    await asUserA(request(app).post('/api/vat-returns'))
      .send({ year: YEAR, quarter: 1 }).expect(201)

    // Fiscal year overlaps the filed Q1: the quarter shows as declared and the
    // books are closed through Q1's end (not the whole year).
    const year = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'fiscal_year', year: YEAR }),
    ).expect(200)
    expect(year.body.vat.books_closed_through).toBe(`${YEAR}-03-31`)
    expect(year.body.vat.books_closed).toBe(false)
    expect(year.body.vat.returns).toHaveLength(1)
    expect(year.body.vat.returns[0]).toMatchObject({ year: YEAR, quarter: 1, direction: 'payable' })

    // Scoping to Q1 itself: the period is fully closed.
    const q1 = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'quarter', year: YEAR, quarter: 1 }),
    ).expect(200)
    expect(q1.body.vat.books_closed).toBe(true)
    expect(q1.body.vat.returns).toHaveLength(1)

    // A later quarter with no activity has no return and stays open.
    const q3 = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'quarter', year: YEAR, quarter: 3 }),
    ).expect(200)
    expect(q3.body.vat.returns).toEqual([])
    expect(q3.body.vat.books_closed).toBe(false)
  })

  it('excludes activity outside the requested period but keeps balance-sheet history', async () => {
    await createSentInvoice({ issue_date: `${YEAR - 1}-03-01` })

    const res = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'fiscal_year', year: YEAR }),
    ).expect(200)

    // No P&L movement in the period…
    expect(res.body.profit_loss.totals.result_cents).toBe(0)
    expect(res.body.trial_balance.rows).toEqual([])
    // …but the receivable from last year is still on the books.
    expect(res.body.balance_sheet.totals.assets_cents).toBe(121000)
    expect(res.body.balance_sheet.unallocated_result_cents).toBe(100000)

    await asUserA(request(app).get('/api/ledger/report').query({ mode: 'nope' })).expect(400)
  })

  it('exports xlsx and pdf with attachment headers', async () => {
    await createSentInvoice()

    const xlsx = await asUserA(
      request(app).get('/api/ledger/report/export')
        .query({ mode: 'fiscal_year', year: YEAR, format: 'xlsx' })
        .buffer(true).parse((res, cb) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => cb(null, Buffer.concat(chunks)))
        }),
    ).expect(200)
    expect(xlsx.headers['content-type']).toContain('spreadsheetml')
    expect(xlsx.headers['content-disposition']).toContain('financial-report-FY-2026.xlsx')
    expect(xlsx.body.length).toBeGreaterThan(0)
    // xlsx files are zip archives: PK magic bytes
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK')

    const pdf = await asUserA(
      request(app).get('/api/ledger/report/export')
        .query({ mode: 'fiscal_year', year: YEAR, format: 'pdf' })
        .buffer(true).parse((res, cb) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => cb(null, Buffer.concat(chunks)))
        }),
    ).expect(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-')

    await asUserA(
      request(app).get('/api/ledger/report/export').query({ mode: 'fiscal_year', year: YEAR, format: 'doc' }),
    ).expect(400)
  })

  it('is tenant-isolated: B sees an empty report despite A\'s activity', async () => {
    await createSentInvoice()
    await createAccruedPurchase()

    const res = await asUserB(
      request(app).get('/api/ledger/report').query({ mode: 'fiscal_year', year: YEAR }),
    ).expect(200)

    expect(res.body.profit_loss.totals).toEqual({
      revenue_cents: 0, cogs_cents: 0, gross_profit_cents: 0, expense_cents: 0, result_cents: 0,
    })
    expect(res.body.balance_sheet.totals.assets_cents).toBe(0)
    expect(res.body.vat).toMatchObject({ output_cents: 0, input_cents: 0, net_cents: 0, returns: [] })
    expect(res.body.trial_balance.rows).toEqual([])
  })
})

describe('financial report — voids excluded, reversals included', () => {
  async function purchaseLedgerId() {
    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    return list.body.find((r) => r.source_type === 'purchase').id
  }
  async function closeBooksThrough(date) {
    await asUserA(request(app).patch('/api/accounts/settings')).send({ books_closed_through: date }).expect(200)
  }

  it('drops a voided open-period entry from the P&L, balance sheet and VAT', async () => {
    await createAccruedPurchase() // expense 2066 on 62100, input VAT 434, payable 2500, dated 2026-02-15

    const before = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'fiscal_year', year: YEAR }),
    ).expect(200)
    expect(before.body.profit_loss.totals.expense_cents).toBe(2066)

    const id = await purchaseLedgerId()
    await asUserA(request(app).post(`/api/ledger/${id}/void`)).expect(200)

    const after = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'fiscal_year', year: YEAR }),
    ).expect(200)
    expect(after.body.profit_loss.totals.expense_cents).toBe(0)
    expect(after.body.profit_loss.expenses.find((r) => r.code === '62100')).toBeUndefined()
    // The voided pair drops out of the balance sheet and VAT too.
    expect(after.body.balance_sheet.totals.assets_cents).toBe(0)
    expect(after.body.balance_sheet.totals.liabilities_cents).toBe(0)
    expect(after.body.vat).toMatchObject({ output_cents: 0, input_cents: 0, net_cents: 0 })
  })

  it('keeps a reversed closed-period entry in its own period but nets it out across the year', async () => {
    await createAccruedPurchase() // dated 2026-02-15
    await closeBooksThrough(`${YEAR}-05-31`)

    const id = await purchaseLedgerId()
    await asUserA(request(app).post(`/api/ledger/${id}/reverse`)).expect(200)

    // The original closed-period expense is still reported in February…
    const feb = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'month', year: YEAR, month: 1 }),
    ).expect(200)
    expect(feb.body.profit_loss.expenses.find((r) => r.code === '62100')).toMatchObject({ amount_cents: 2066 })

    // …but the reversal (dated today) nets it out over the whole year.
    const year = await asUserA(
      request(app).get('/api/ledger/report').query({ mode: 'fiscal_year', year: YEAR }),
    ).expect(200)
    expect(year.body.profit_loss.totals.expense_cents).toBe(0)
  })
})
