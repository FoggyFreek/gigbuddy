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

// The overview's VAT card is pinned to the quarter containing "today", so the
// money fixtures are dated relative to the real clock to stay in that quarter.
const NOW = new Date()
const THIS_YEAR = NOW.getFullYear()
const THIS_MONTH = NOW.getMonth() + 1
const THIS_QUARTER = Math.floor(NOW.getMonth()/ 3) + 1
const TODAY = `${THIS_YEAR}-${String(THIS_MONTH).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`
const LAST_YEAR = THIS_YEAR - 1

// Last day of the month after the current quarter ends (mirrors the service).
function expectedVatDueDate() {
  const startMonth = (THIS_QUARTER - 1) * 3 + 1
  const d = new Date(Date.UTC(THIS_YEAR, startMonth - 1 + 4, 1))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ---------- payload builders / drivers ----------

function invoicePayload(overrides = {}) {
  return {
    customer_name: 'Texel Buitengewoon',
    issue_date: TODAY,
    payment_term_days: 14,
    tax_inclusive: false,
    discount_cents: 0,
    lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 100000, tax_percentage: 21 }],
    ...overrides,
  }
}

async function createInvoice(overrides = {}, as = asUserA) {
  const r = await as(request(app).post('/api/invoices')).send(invoicePayload(overrides)).expect(201)
  return r.body
}

async function createSentInvoice(overrides = {}, as = asUserA) {
  const inv = await createInvoice(overrides, as)
  await as(request(app).patch(`/api/invoices/${inv.id}`)).send({ status: 'sent' }).expect(200)
  return inv
}

// Accrued purchase: gross 2500 at 21% → net 2066, VAT 434, dated today.
async function createAccruedPurchase(as = asUserA) {
  const r = await as(request(app).post('/api/purchases')).send({
    supplier_name: 'mi5 Studios',
    receipt_date: TODAY,
    memo: 'TEST',
    status: 'approved',
    lines: [
      { description: 'Studio day', account_code: '62100', tax_rate: 21, amount_incl_cents: 2500 },
    ],
  }).expect(201)
  return r.body
}

// Inserts a gig directly (the create API doesn't accept a fee; it's patched
// later). Returns nothing — these only feed the upcoming-fees aggregate.
async function insertGig(tenantId, { daysFromToday, status, feeCents }) {
  const d = new Date(NOW)
  d.setDate(d.getDate() + daysFromToday)
  const eventDate = d.toISOString().slice(0, 10)
  await pool.query(
    `INSERT INTO gigs (tenant_id, event_date, event_description, status, booking_fee_cents)
     VALUES ($1, $2, 'Test gig', $3, $4)`,
    [tenantId, eventDate, status, feeCents],
  )
}

// ============================================================
describe('financial overview', () => {
  it('aggregates monthly revenue/expenses/result for a fiscal year', async () => {
    await createSentInvoice() // revenue 100000 net, this month
    await createAccruedPurchase() // expense 2066 net, this month

    const res = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: THIS_YEAR }),
    ).expect(200)

    expect(res.body.currency).toBe('EUR')
    expect(res.body.months).toHaveLength(12)

    const thisMonth = res.body.months.find((m) => m.month === THIS_MONTH)
    expect(thisMonth).toEqual({
      key: `${THIS_YEAR}-${String(THIS_MONTH).padStart(2, '0')}`,
      year: THIS_YEAR,
      month: THIS_MONTH,
      revenue_cents: 100000,
      expense_cents: 2066,
      result_cents: 97934,
    })

    const emptyMonth = res.body.months.find((m) => m.month !== THIS_MONTH)
    expect(emptyMonth.revenue_cents).toBe(0)
    expect(emptyMonth.expense_cents).toBe(0)

    expect(res.body.totals).toEqual({ revenue_cents: 100000, expense_cents: 2066, result_cents: 97934 })
  })

  it('supports quarter periods and excludes activity outside the period', async () => {
    await createSentInvoice()

    const inQuarter = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'quarter', year: THIS_YEAR, quarter: THIS_QUARTER }),
    ).expect(200)
    expect(inQuarter.body.months).toHaveLength(3)
    expect(inQuarter.body.totals.revenue_cents).toBe(100000)

    const empty = THIS_QUARTER === 1
      ? { year: LAST_YEAR, quarter: 4 }
      : { year: THIS_YEAR, quarter: THIS_QUARTER - 1 }
    const outOfQuarter = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'quarter', ...empty }),
    ).expect(200)
    expect(outOfQuarter.body.totals).toEqual({ revenue_cents: 0, expense_cents: 0, result_cents: 0 })

    await asUserA(request(app).get('/api/ledger/overview').query({ mode: 'nope' })).expect(400)
  })

  it('spans all booked months when no period is given', async () => {
    await createSentInvoice({ issue_date: `${LAST_YEAR}-03-01` })
    await createAccruedPurchase()

    const res = await asUserA(request(app).get('/api/ledger/overview')).expect(200)

    expect(res.body.months[0].key).toBe(`${LAST_YEAR}-03`)
    expect(res.body.months[res.body.months.length - 1].key)
      .toBe(`${THIS_YEAR}-${String(THIS_MONTH).padStart(2, '0')}`)
    expect(res.body.totals).toEqual({ revenue_cents: 100000, expense_cents: 2066, result_cents: 97934 })
  })

  it('reports the trailing three calendar years of result, pinned to today', async () => {
    await createSentInvoice() // revenue 100000 net, this year
    await createAccruedPurchase() // expense 2066 net, this year
    await createSentInvoice({ issue_date: `${LAST_YEAR}-03-01` }) // revenue 100000 net, last year

    const res = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: THIS_YEAR }),
    ).expect(200)

    // Three years regardless of the selected period, oldest → newest.
    expect(res.body.annual_results).toHaveLength(3)
    expect(res.body.annual_results.map((r) => r.year)).toEqual([THIS_YEAR - 2, LAST_YEAR, THIS_YEAR])

    const thisYear = res.body.annual_results.find((r) => r.year === THIS_YEAR)
    expect(thisYear).toEqual({ year: THIS_YEAR, has_data: true, revenue_cents: 100000, expense_cents: 2066, result_cents: 97934 })

    const lastYear = res.body.annual_results.find((r) => r.year === LAST_YEAR)
    expect(lastYear).toEqual({ year: LAST_YEAR, has_data: true, revenue_cents: 100000, expense_cents: 0, result_cents: 100000 })

    // No activity two years ago → flagged so the chart renders a gap, not a zero.
    const oldest = res.body.annual_results.find((r) => r.year === THIS_YEAR - 2)
    expect(oldest).toEqual({ year: THIS_YEAR - 2, has_data: false, revenue_cents: 0, expense_cents: 0, result_cents: 0 })
  })

  it('reports the VAT position of the current quarter with its due date', async () => {
    await createSentInvoice() // output VAT 21000, today
    await createAccruedPurchase() // input VAT 434, today
    await createSentInvoice({ issue_date: `${LAST_YEAR}-03-01` }) // outside the quarter

    const res = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: THIS_YEAR }),
    ).expect(200)

    expect(res.body.vat).toEqual({
      year: THIS_YEAR,
      quarter: THIS_QUARTER,
      due_date: expectedVatDueDate(),
      output_cents: 21000,
      input_cents: 434,
      net_cents: 20566,
    })
  })

  it('derives the bank balance from postings on the settings\' checking account', async () => {
    // Paid invoice: DR checking 121000. Bank-paid bill: CR checking 2500.
    const inv = await createSentInvoice()
    await asUserA(request(app).patch(`/api/invoices/${inv.id}`)).send({ status: 'paid' }).expect(200)
    const purchase = await createAccruedPurchase()
    await asUserA(request(app).post(`/api/purchases/${purchase.id}/payment`))
      .send({ method: 'bank', paid_on: TODAY }).expect(200)

    const res = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: THIS_YEAR }),
    ).expect(200)
    expect(res.body.bank).toEqual({ balance_cents: 118500 })

    // The balance is point-in-time: an out-of-period query reports the same figure.
    const elsewhere = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: LAST_YEAR }),
    ).expect(200)
    expect(elsewhere.body.bank).toEqual({ balance_cents: 118500 })
  })

  it('buckets open invoices into overdue / unpaid / draft with totals', async () => {
    await createInvoice() // draft, 121000
    await createSentInvoice({ payment_term_days: 60 }) // due in the future → unpaid
    await createSentInvoice({ issue_date: `${LAST_YEAR}-01-01`, payment_term_days: 14 }) // long overdue

    // A paid invoice leaves the open buckets.
    const paid = await createSentInvoice({ payment_term_days: 60 })
    await asUserA(request(app).patch(`/api/invoices/${paid.id}`)).send({ status: 'paid' }).expect(200)

    const res = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: THIS_YEAR }),
    ).expect(200)

    expect(res.body.invoices.draft).toEqual({ count: 1, total_cents: 121000 })
    expect(res.body.invoices.unpaid).toEqual({ count: 1, total_cents: 121000 })
    expect(res.body.invoices.overdue).toEqual({ count: 1, total_cents: 121000 })
  })

  it('sums upcoming gross band fees with a per-status breakdown', async () => {
    await insertGig(seed.tenantA.id, { daysFromToday: 7, status: 'confirmed', feeCents: 250000 })
    await insertGig(seed.tenantA.id, { daysFromToday: 30, status: 'announced', feeCents: 100000 })
    await insertGig(seed.tenantA.id, { daysFromToday: 14, status: 'option', feeCents: 50000 })
    // Excluded: a past gig, and an upcoming gig with no fee set.
    await insertGig(seed.tenantA.id, { daysFromToday: -7, status: 'confirmed', feeCents: 999999 })
    await insertGig(seed.tenantA.id, { daysFromToday: 21, status: 'confirmed', feeCents: null })

    const res = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: THIS_YEAR }),
    ).expect(200)

    expect(res.body.upcoming_fees).toEqual({
      total_cents: 400000,
      gig_count: 3,
      by_status: {
        option: { count: 1, total_cents: 50000 },
        confirmed: { count: 1, total_cents: 250000 },
        announced: { count: 1, total_cents: 100000 },
      },
    })
  })

  it('reports zero upcoming fees when there are no future fee-bearing gigs', async () => {
    const res = await asUserA(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: THIS_YEAR }),
    ).expect(200)

    expect(res.body.upcoming_fees).toEqual({
      total_cents: 0,
      gig_count: 0,
      by_status: {
        option: { count: 0, total_cents: 0 },
        confirmed: { count: 0, total_cents: 0 },
        announced: { count: 0, total_cents: 0 },
      },
    })
  })

  it('is tenant-isolated: B sees zeros for A\'s activity', async () => {
    await createSentInvoice()
    await createAccruedPurchase()
    await insertGig(seed.tenantA.id, { daysFromToday: 7, status: 'confirmed', feeCents: 250000 })

    const resB = await asUserB(
      request(app).get('/api/ledger/overview').query({ mode: 'fiscal_year', year: THIS_YEAR }),
    ).expect(200)
    expect(resB.body.totals).toEqual({ revenue_cents: 0, expense_cents: 0, result_cents: 0 })
    expect(resB.body.annual_results.every((r) => r.result_cents === 0)).toBe(true)
    expect(resB.body.vat.output_cents).toBe(0)
    expect(resB.body.vat.input_cents).toBe(0)
    expect(resB.body.vat.net_cents).toBe(0)
    expect(resB.body.bank).toEqual({ balance_cents: 0 })
    expect(resB.body.invoices.draft).toEqual({ count: 0, total_cents: 0 })
    expect(resB.body.invoices.unpaid).toEqual({ count: 0, total_cents: 0 })
    expect(resB.body.invoices.overdue).toEqual({ count: 0, total_cents: 0 })
    expect(resB.body.upcoming_fees.total_cents).toBe(0)
    expect(resB.body.upcoming_fees.gig_count).toBe(0)
  })
})
