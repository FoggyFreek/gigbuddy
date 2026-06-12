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

    // VAT
    expect(vat).toEqual({ output_cents: 21000, input_cents: 434, net_cents: 20566 })

    // Trial balance always balances
    expect(trial_balance.totals.debit_cents).toBe(trial_balance.totals.credit_cents)
    expect(trial_balance.rows.length).toBeGreaterThan(0)
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
    expect(res.body.vat).toEqual({ output_cents: 0, input_cents: 0, net_cents: 0 })
    expect(res.body.trial_balance.rows).toEqual([])
  })
})
