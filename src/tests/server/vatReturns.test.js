import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

// Stub MinIO so the invoice PDF render path is a no-op (we assert DB/ledger state).
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

// ---------- ledger query helpers (mirrors ledger.test.js — those are file-local) ----------

async function journalsFor(tenantId, sourceType, sourceId) {
  const { rows: txns } = await pool.query(
    `SELECT *, to_char(entry_date, 'YYYY-MM-DD') AS entry_date_str
       FROM ledger_transactions
      WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3
      ORDER BY id`,
    [tenantId, sourceType, sourceId],
  )
  const out = []
  for (const t of txns) {
    const { rows: entries } = await pool.query(
      `SELECT account_code, debit_cents, credit_cents
         FROM ledger_entries WHERE transaction_id = $1 ORDER BY id`,
      [t.id],
    )
    out.push({ ...t, entries })
  }
  return out
}

const byEvent = (journals, event) => journals.find((j) => j.source_event === event)
const sumDebit = (j) => j.entries.reduce((s, e) => s + e.debit_cents, 0)
const sumCredit = (j) => j.entries.reduce((s, e) => s + e.credit_cents, 0)
const line = (j, code) => j.entries.find((e) => e.account_code === code)

function expectBalanced(j) {
  expect(sumDebit(j)).toBe(sumCredit(j))
  expect(sumDebit(j)).toBeGreaterThan(0)
}

async function accountBalance(tenantId, code) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(debit_cents - credit_cents), 0)::int AS bal
       FROM ledger_entries WHERE tenant_id = $1 AND account_code = $2`,
    [tenantId, code],
  )
  return rows[0].bal
}

// ---------- seeding: VAT activity inside Q1 2026 (a *past* quarter) ----------
// Output VAT comes from a sent invoice (issue_date drives the entry date);
// input VAT from an accrued bill (receipt_date).

async function createSentInvoice({ unitPriceCents = 200000, issueDate = '2026-02-01' } = {}) {
  const r = await asUserA(request(app).post('/api/invoices')).send({
    customer_name: 'Alpha Hall',
    issue_date: issueDate,
    payment_term_days: 14,
    tax_inclusive: false,
    discount_cents: 0,
    lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: unitPriceCents, tax_percentage: 21 }],
  }).expect(201)
  await asUserA(request(app).patch(`/api/invoices/${r.body.id}`)).send({ status: 'sent' }).expect(200)
  return r.body
}

async function createBill({ amountInclCents = 121000, receiptDate = '2026-02-10' } = {}) {
  const r = await asUserA(request(app).post('/api/purchases')).send({
    supplier_name: 'mi5 Studios',
    receipt_date: receiptDate,
    status: 'approved',
    lines: [
      { description: 'Studio day', account_code: '62100', tax_rate: 21, amount_incl_cents: amountInclCents },
    ],
  }).expect(201)
  return r.body
}

function fileReturn(body) {
  return asUserA(request(app).post('/api/vat-returns')).send({ year: 2026, quarter: 1, ...body })
}

// ============================================================
describe('VAT returns — preview', () => {
  it('returns the period breakdown without writing anything', async () => {
    await createSentInvoice()  // output VAT 42000
    await createBill()         // input VAT 21000

    const res = await asUserA(request(app).get('/api/vat-returns/preview?year=2026&quarter=1')).expect(200)
    expect(res.body).toMatchObject({
      year: 2026,
      quarter: 1,
      period_from: '2026-01-01',
      period_to: '2026-03-31',
      due_date: '2026-04-30',
      output_vat_cents: 42000,
      input_vat_cents: 21000,
      net_cents: 21000,
      direction: 'payable',
    })

    const { rows } = await pool.query('SELECT * FROM vat_returns WHERE tenant_id = $1', [seed.tenantA.id])
    expect(rows).toHaveLength(0)
  })

  it('rejects an invalid quarter', async () => {
    await asUserA(request(app).get('/api/vat-returns/preview?year=2026&quarter=5')).expect(400)
  })
})

describe('VAT returns — filing (settlement journal)', () => {
  it('payable: zeroes 15000/24000 and credits the net to 24010, balanced', async () => {
    await createSentInvoice()  // output 42000
    await createBill()         // input 21000

    const res = await fileReturn().expect(201)
    expect(res.body).toMatchObject({
      year: 2026, quarter: 1,
      output_vat_cents: 42000, input_vat_cents: 21000, net_cents: 21000,
      direction: 'payable', settlement_account_code: '24010', status: 'unpaid',
    })

    const journals = await journalsFor(seed.tenantA.id, 'vat_settlement', res.body.id)
    const filed = byEvent(journals, 'filed')
    expect(filed).toBeTruthy()
    expectBalanced(filed)
    expect(filed.entry_date_str).toBe('2026-03-31')
    expect(line(filed, '24000').debit_cents).toBe(42000)
    expect(line(filed, '15000').credit_cents).toBe(21000)
    expect(line(filed, '24010').credit_cents).toBe(21000)

    expect(await accountBalance(seed.tenantA.id, '24000')).toBe(0)
    expect(await accountBalance(seed.tenantA.id, '15000')).toBe(0)
  })

  it('receivable: net lands as a debit on 15010', async () => {
    await createSentInvoice({ unitPriceCents: 50000 })  // output 10500
    await createBill()                                  // input 21000

    const res = await fileReturn().expect(201)
    expect(res.body).toMatchObject({
      net_cents: -10500, direction: 'receivable',
      settlement_account_code: '15010', status: 'not_received',
    })

    const filed = byEvent(await journalsFor(seed.tenantA.id, 'vat_settlement', res.body.id), 'filed')
    expectBalanced(filed)
    expect(line(filed, '15010').debit_cents).toBe(10500)
  })

  it('nil: equal input and output settle with no settlement-account line', async () => {
    await createSentInvoice({ unitPriceCents: 100000 })  // output 21000
    await createBill()                                   // input 21000

    const res = await fileReturn().expect(201)
    expect(res.body).toMatchObject({ net_cents: 0, direction: 'nil', settlement_account_code: null, status: 'settled' })

    const filed = byEvent(await journalsFor(seed.tenantA.id, 'vat_settlement', res.body.id), 'filed')
    expectBalanced(filed)
    expect(line(filed, '24010')).toBeUndefined()
    expect(line(filed, '15010')).toBeUndefined()
  })

  it('a negative accumulation balance posts on the opposite side — never a negative line', async () => {
    // Force output VAT negative: a correction journal debiting 24000 with no other VAT.
    const { rows: [txn] } = await pool.query(
      `INSERT INTO ledger_transactions (tenant_id, entry_date, description, source_type, source_id, source_event)
       VALUES ($1, '2026-02-01', 'correction', 'journal', 999, 'posted') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO ledger_entries (tenant_id, transaction_id, account_code, debit_cents, credit_cents) VALUES
         ($1, $2, '24000', 5000, 0), ($1, $2, '33000', 0, 5000)`,
      [seed.tenantA.id, txn.id],
    )

    const res = await fileReturn().expect(201)
    expect(res.body).toMatchObject({
      output_vat_cents: -5000, input_vat_cents: 0,
      net_cents: -5000, direction: 'receivable',
    })

    const filed = byEvent(await journalsFor(seed.tenantA.id, 'vat_settlement', res.body.id), 'filed')
    expectBalanced(filed)
    for (const e of filed.entries) {
      expect(e.debit_cents).toBeGreaterThanOrEqual(0)
      expect(e.credit_cents).toBeGreaterThanOrEqual(0)
    }
    expect(line(filed, '24000').credit_cents).toBe(5000)
    expect(line(filed, '15010').debit_cents).toBe(5000)
    expect(await accountBalance(seed.tenantA.id, '24000')).toBe(0)
  })

  it('rejects when there is nothing to settle', async () => {
    const res = await fileReturn().expect(400)
    expect(res.body.code).toBe('nothing_to_settle')
  })

  it('rejects a duplicate return for the same quarter', async () => {
    await createSentInvoice()
    await fileReturn().expect(201)
    await createSentInvoice({ issueDate: '2026-04-05' })
    const res = await fileReturn().expect(409)
    expect(res.body.code).toBe('already_filed')
  })

  it('rejects filing the current (unfinished) quarter', async () => {
    await createSentInvoice({ issueDate: '2026-06-01' })
    const res = await fileReturn({ year: 2026, quarter: 2 }).expect(400)
    expect(res.body.code).toBe('period_not_ended')
  })

  it('auto-closes the books through the period end', async () => {
    await createSentInvoice()
    await fileReturn().expect(201)

    const { rows } = await pool.query(
      `SELECT to_char(books_closed_through, 'YYYY-MM-DD') AS closed
         FROM tenant_accounting_settings WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(rows[0].closed).toBe('2026-03-31')

    // A new posting dated inside the settled quarter is rejected.
    const inv = await asUserA(request(app).post('/api/invoices')).send({
      customer_name: 'Late Hall', issue_date: '2026-03-15', payment_term_days: 14,
      tax_inclusive: false, discount_cents: 0,
      lines: [{ description: 'Late', quantity: 1, unit_price_cents: 1000, tax_percentage: 21 }],
    }).expect(201)
    const late = await asUserA(request(app).patch(`/api/invoices/${inv.body.id}`)).send({ status: 'sent' })
    expect(late.status).toBe(409)
    expect(late.body.code).toBe('period_closed')
  })

  it('rejects filing an earlier quarter after a later one (period closed)', async () => {
    await createSentInvoice()
    await fileReturn().expect(201)
    const res = await fileReturn({ year: 2025, quarter: 4 })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('period_closed')
  })
})

describe('VAT returns — payments and refunds', () => {
  async function filePayableReturn() {
    await createSentInvoice()  // output 42000
    await createBill()         // input 21000 → net payable 21000
    const res = await fileReturn().expect(201)
    return res.body
  }

  it('partial then final payment: journal DR 24010 / CR bank, status progresses to paid', async () => {
    const ret = await filePayableReturn()

    const p1 = await asUserA(request(app).post(`/api/vat-returns/${ret.id}/payments`))
      .send({ amount_cents: 6000, paid_on: '2026-04-15', direction: 'payment' }).expect(201)
    let detail = await asUserA(request(app).get(`/api/vat-returns/${ret.id}`)).expect(200)
    expect(detail.body.status).toBe('partially_paid')
    expect(detail.body.paid_cents).toBe(6000)

    const j1 = byEvent(await journalsFor(seed.tenantA.id, 'vat_settlement_payment', p1.body.id), 'paid')
    expectBalanced(j1)
    expect(line(j1, '24010').debit_cents).toBe(6000)
    // Defaults to the primary checking account from settings.
    expect(line(j1, '11000').credit_cents).toBe(6000)

    await asUserA(request(app).post(`/api/vat-returns/${ret.id}/payments`))
      .send({ amount_cents: 15000, paid_on: '2026-04-20', direction: 'payment' }).expect(201)
    detail = await asUserA(request(app).get(`/api/vat-returns/${ret.id}`)).expect(200)
    expect(detail.body.status).toBe('paid')
    expect(detail.body.payments).toHaveLength(2)
    expect(await accountBalance(seed.tenantA.id, '24010')).toBe(0)
  })

  it('accepts an explicit asset bank account', async () => {
    const ret = await filePayableReturn()
    const p = await asUserA(request(app).post(`/api/vat-returns/${ret.id}/payments`))
      .send({ amount_cents: 21000, paid_on: '2026-04-15', direction: 'payment', bank_account_code: '11000' })
      .expect(201)
    expect(p.body.bank_account_code).toBe('11000')
  })

  it('refund on a receivable return: DR bank / CR 15010', async () => {
    await createBill()  // input 21000, no output → receivable 21000
    const ret = (await fileReturn().expect(201)).body
    expect(ret.direction).toBe('receivable')

    const p = await asUserA(request(app).post(`/api/vat-returns/${ret.id}/payments`))
      .send({ amount_cents: 21000, paid_on: '2026-04-15', direction: 'refund' }).expect(201)

    const j = byEvent(await journalsFor(seed.tenantA.id, 'vat_settlement_payment', p.body.id), 'paid')
    expectBalanced(j)
    expect(line(j, '11000').debit_cents).toBe(21000)
    expect(line(j, '15010').credit_cents).toBe(21000)

    const detail = await asUserA(request(app).get(`/api/vat-returns/${ret.id}`)).expect(200)
    expect(detail.body.status).toBe('received')
  })

  it('rejects a refund against a payable return (and vice versa)', async () => {
    const ret = await filePayableReturn()
    const res = await asUserA(request(app).post(`/api/vat-returns/${ret.id}/payments`))
      .send({ amount_cents: 1000, paid_on: '2026-04-15', direction: 'refund' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('direction_mismatch')
  })

  it('rejects overpaying the outstanding amount', async () => {
    const ret = await filePayableReturn()
    const res = await asUserA(request(app).post(`/api/vat-returns/${ret.id}/payments`))
      .send({ amount_cents: 21001, paid_on: '2026-04-15', direction: 'payment' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('overpayment')
  })

  it('rejects a non-asset bank account', async () => {
    const ret = await filePayableReturn()
    const res = await asUserA(request(app).post(`/api/vat-returns/${ret.id}/payments`))
      .send({ amount_cents: 1000, paid_on: '2026-04-15', direction: 'payment', bank_account_code: '41000' })
    expect(res.status).toBe(400)
  })
})

describe('VAT returns — list', () => {
  it('lists returns with derived status, newest period first', async () => {
    await createSentInvoice()
    await createBill()
    await fileReturn().expect(201)

    const res = await asUserA(request(app).get('/api/vat-returns')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      year: 2026, quarter: 1, net_cents: 21000, direction: 'payable',
      status: 'unpaid', paid_cents: 0,
    })
  })
})

describe('VAT returns — authorization & tenant isolation', () => {
  it('a non-admin member gets 403', async () => {
    await pool.query(
      `UPDATE memberships SET role = 'member' WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )
    await asUserA(request(app).get('/api/vat-returns')).expect(403)
  })

  it('cross-tenant get, file and pay all 404 / stay isolated', async () => {
    await createSentInvoice()
    const ret = (await fileReturn().expect(201)).body

    await asUserB(request(app).get(`/api/vat-returns/${ret.id}`)).expect(404)
    await asUserB(request(app).post(`/api/vat-returns/${ret.id}/payments`))
      .send({ amount_cents: 1000, paid_on: '2026-04-15', direction: 'payment' }).expect(404)

    // Tenant B's list and balances are untouched by A's filing.
    const listB = await asUserB(request(app).get('/api/vat-returns')).expect(200)
    expect(listB.body).toHaveLength(0)
    expect(await accountBalance(seed.tenantB.id, '24010')).toBe(0)
  })
})
