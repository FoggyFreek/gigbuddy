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

// ---------- payload builders / drivers ----------

function invoicePayload(overrides = {}) {
  return {
    customer_name: 'Texel Buitengewoon',
    issue_date: '2026-06-09',
    payment_term_days: 14,
    tax_inclusive: false,
    discount_cents: 0,
    lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 100000, tax_percentage: 21 }],
    ...overrides,
  }
}

function purchasePayload(overrides = {}) {
  return {
    supplier_name: 'mi5 Studios',
    receipt_date: '2026-06-12',
    memo: 'TEST',
    lines: [
      { description: 'Studio day', account_code: '62100', tax_rate: 21, amount_incl_cents: 2500 },
    ],
    ...overrides,
  }
}

async function createSentInvoice(as = asUserA) {
  const r = await as(request(app).post('/api/invoices')).send(invoicePayload()).expect(201)
  await as(request(app).patch(`/api/invoices/${r.body.id}`)).send({ status: 'sent' }).expect(200)
  return r.body
}

async function createAccruedPurchase(as = asUserA) {
  const r = await as(request(app).post('/api/purchases'))
    .send(purchasePayload({ status: 'approved' })).expect(201)
  return r.body
}

async function createPostedJournal(as = asUserA) {
  const r = await as(request(app).post('/api/journal')).send({
    entry_date: '2026-06-10',
    description: 'Initial',
    lines: [
      { description: 'T', account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 1000, balancing_account_code: '11000' },
    ],
  }).expect(201)
  await as(request(app).post(`/api/journal/${r.body.id}/approve`)).expect(200)
  return r.body
}

// ============================================================
describe('ledger browser — list', () => {
  it('returns the tenant\'s ledger rows with type/receipt/description/amount mapping', async () => {
    const inv = await createSentInvoice()
    await asUserA(request(app).patch(`/api/invoices/${inv.id}`)).send({ status: 'paid' }).expect(200)
    const purchase = await createAccruedPurchase()
    const journal = await createPostedJournal()

    const res = await asUserA(request(app).get('/api/ledger')).expect(200)
    expect(res.body).toHaveLength(4)

    const byType = Object.fromEntries(res.body.map((r) => [`${r.source_type}/${r.source_event}`, r]))

    const sent = byType['invoice/sent']
    expect(sent.type).toBe('Invoice')
    expect(sent.group).toBe('invoices')
    expect(sent.voided).toBe(false)
    expect(sent.receipt).toBeNull()
    expect(sent.description).toBe(`Invoice number ${inv.invoice_number} for Texel Buitengewoon`)
    expect(sent.amount_cents).toBe(121000)
    expect(sent.entry_date).toBe('2026-06-09')

    const paid = byType['invoice/paid']
    expect(paid.type).toBe('Ingoing payment')
    expect(paid.group).toBe('payments')
    expect(paid.description).toBe(`Paid by Texel Buitengewoon for invoice ${inv.invoice_number}`)
    expect(paid.amount_cents).toBe(121000)

    const accrued = byType['purchase/accrued']
    expect(accrued.type).toBe('Purchase')
    expect(accrued.group).toBe('purchases')
    expect(accrued.receipt).toBe(purchase.receipt_number)
    expect(accrued.description).toBe('Bill from mi5 Studios: TEST')
    expect(accrued.amount_cents).toBe(-2500)

    const posted = byType['journal/posted']
    expect(posted.type).toBe('Journal')
    expect(posted.group).toBe('journals')
    expect(posted.receipt).toBe(journal.entry_number)
    expect(posted.description).toBe('Initial')
    expect(posted.amount_cents).toBeNull()
  })

  it('marks invoice void rows as voided', async () => {
    const inv = await createSentInvoice()
    await asUserA(request(app).patch(`/api/invoices/${inv.id}`)).send({ status: 'void' }).expect(200)

    const res = await asUserA(request(app).get('/api/ledger')).expect(200)
    const voidRow = res.body.find((r) => r.source_event === 'void')
    expect(voidRow.type).toBe('Invoice (void)')
    expect(voidRow.voided).toBe(true)
    expect(voidRow.description).toBe(`Invoice ${inv.invoice_number} voided`)
  })

  it('filters by period query params and 400s on an invalid period', async () => {
    await createSentInvoice() // entry_date 2026-06-09

    const inPeriod = await asUserA(
      request(app).get('/api/ledger').query({ mode: 'month', year: 2026, month: 5 }),
    ).expect(200)
    expect(inPeriod.body).toHaveLength(1)

    const outOfPeriod = await asUserA(
      request(app).get('/api/ledger').query({ mode: 'month', year: 2026, month: 0 }),
    ).expect(200)
    expect(outOfPeriod.body).toHaveLength(0)

    await asUserA(request(app).get('/api/ledger').query({ mode: 'nope' })).expect(400)
  })

  it('is tenant-isolated: B sees none of A\'s rows', async () => {
    await createSentInvoice()
    const resB = await asUserB(request(app).get('/api/ledger')).expect(200)
    expect(resB.body).toHaveLength(0)
  })
})

describe('ledger browser — periods', () => {
  it('returns the tenant\'s distinct entry dates only', async () => {
    await createSentInvoice()
    const resA = await asUserA(request(app).get('/api/ledger/periods')).expect(200)
    expect(resA.body).toEqual(['2026-06-09'])

    const resB = await asUserB(request(app).get('/api/ledger/periods')).expect(200)
    expect(resB.body).toEqual([])
  })
})

describe('ledger browser — detail', () => {
  it('returns header, lines joined to account names, and origin', async () => {
    const purchase = await createAccruedPurchase()
    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    const row = list.body.find((r) => r.source_type === 'purchase')

    const res = await asUserA(request(app).get(`/api/ledger/${row.id}`)).expect(200)
    expect(res.body.id).toBe(row.id)
    expect(res.body.description).toBe('Bill from mi5 Studios: TEST')
    expect(res.body.receipt).toBe(purchase.receipt_number)
    expect(res.body.entry_date).toBe('2026-06-12')
    expect(res.body.created_by_name).toBe('Alpha User')
    expect(res.body.origin).toEqual({ label: 'Bill from mi5 Studios: TEST', path: `/purchases/${purchase.id}` })

    expect(res.body.lines.length).toBeGreaterThanOrEqual(2)
    for (const line of res.body.lines) {
      expect(line).toHaveProperty('account_code')
      expect(line).toHaveProperty('account_name')
      expect(line).toHaveProperty('debit_cents')
      expect(line).toHaveProperty('credit_cents')
    }
    const totalDebit = res.body.lines.reduce((s, l) => s + l.debit_cents, 0)
    const totalCredit = res.body.lines.reduce((s, l) => s + l.credit_cents, 0)
    expect(totalDebit).toBe(totalCredit)
    expect(totalDebit).toBe(2500)
    const accountNames = res.body.lines.map((l) => l.account_name)
    expect(accountNames.some(Boolean)).toBe(true)
  })

  it('cross-tenant detail read 404s (no existence leak)', async () => {
    await createSentInvoice()
    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    const id = list.body[0].id

    await asUserB(request(app).get(`/api/ledger/${id}`)).expect(404)
  })

  it('404s on a missing id and 400s on a non-numeric id', async () => {
    await asUserA(request(app).get('/api/ledger/999999')).expect(404)
    await asUserA(request(app).get('/api/ledger/abc')).expect(400)
  })
})
