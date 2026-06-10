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
let contactA

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
  contactA = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id)
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))
}

// ---------- ledger query helpers ----------

async function journalsFor(tenantId, sourceType, sourceId) {
  const { rows: txns } = await pool.query(
    `SELECT * FROM ledger_transactions
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

// ---------- payload builders ----------

function invoicePayload(overrides = {}) {
  return {
    customer_name: 'Alpha Hall',
    issue_date: '2026-05-01',
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
    receipt_date: '2026-05-01',
    lines: [
      { description: 'Studio day', account_code: '62100', tax_rate: 21, amount_incl_cents: 125000 },
    ],
    ...overrides,
  }
}

async function createInvoice(overrides) {
  const r = await asUserA(request(app).post('/api/invoices')).send(invoicePayload(overrides)).expect(201)
  return r.body
}
function setInvoiceStatus(id, status) {
  return asUserA(request(app).patch(`/api/invoices/${id}`)).send({ status })
}

// ============================================================
describe('ledger — invoicing (revenue)', () => {
  it('invoice sent posts DR receivable / CR revenue / CR output VAT', async () => {
    const inv = await createInvoice()
    expect(inv.total_cents).toBe(121000)
    await setInvoiceStatus(inv.id, 'sent').expect(200)

    const journals = await journalsFor(seed.tenantA.id, 'invoice', inv.id)
    const sent = byEvent(journals, 'sent')
    expect(sent).toBeTruthy()
    expectBalanced(sent)
    expect(line(sent, '11200').debit_cents).toBe(121000)
    expect(line(sent, '41000').credit_cents).toBe(100000)
    expect(line(sent, '24000').credit_cents).toBe(21000)
  })

  it('invoice paid posts DR checking / CR receivable', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'sent').expect(200)
    await setInvoiceStatus(inv.id, 'paid').expect(200)

    const journals = await journalsFor(seed.tenantA.id, 'invoice', inv.id)
    const paid = byEvent(journals, 'paid')
    expect(paid).toBeTruthy()
    expectBalanced(paid)
    expect(line(paid, '11000').debit_cents).toBe(121000)
    expect(line(paid, '11200').credit_cents).toBe(121000)
  })

  it('invoice void from sent posts the reversal', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'sent').expect(200)
    await setInvoiceStatus(inv.id, 'void').expect(200)

    const journals = await journalsFor(seed.tenantA.id, 'invoice', inv.id)
    const voided = byEvent(journals, 'void')
    expect(voided).toBeTruthy()
    expectBalanced(voided)
    expect(line(voided, '11200').credit_cents).toBe(121000)
    expect(line(voided, '41000').debit_cents).toBe(100000)
    expect(line(voided, '24000').debit_cents).toBe(21000)
  })

  it('invoice void from draft posts no journal', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'void').expect(200)
    const journals = await journalsFor(seed.tenantA.id, 'invoice', inv.id)
    expect(journals).toHaveLength(0)
  })

  it('paid invoice cannot be voided (409) and writes no extra ledger rows', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'sent').expect(200)
    await setInvoiceStatus(inv.id, 'paid').expect(200)

    const res = await setInvoiceStatus(inv.id, 'void')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('cannot_void_paid_invoice')

    const journals = await journalsFor(seed.tenantA.id, 'invoice', inv.id)
    expect(byEvent(journals, 'void')).toBeUndefined()
    expect(journals.map((j) => j.source_event).sort()).toEqual(['paid', 'sent'])
  })

  it('zero-VAT (KOR) invoice omits the output VAT line', async () => {
    await pool.query('UPDATE tenants SET applies_kor = true WHERE id = $1', [seed.tenantA.id])
    const inv = await createInvoice()
    expect(inv.tax_cents).toBe(0)
    await setInvoiceStatus(inv.id, 'sent').expect(200)

    const sent = byEvent(await journalsFor(seed.tenantA.id, 'invoice', inv.id), 'sent')
    expectBalanced(sent)
    expect(sent.entries).toHaveLength(2)
    expect(line(sent, '11200').debit_cents).toBe(100000)
    expect(line(sent, '41000').credit_cents).toBe(100000)
  })
})

// ============================================================
describe('ledger — purchasing (expenses)', () => {
  async function createApprovedBill(overrides) {
    const r = await asUserA(request(app).post('/api/purchases'))
      .send(purchasePayload({ status: 'approved', ...overrides })).expect(201)
    return r.body
  }

  it('bill approved posts expense + input VAT / CR payable', async () => {
    const bill = await createApprovedBill({ supplier_contact_id: contactA.id })
    const accrued = byEvent(await journalsFor(seed.tenantA.id, 'purchase', bill.id), 'accrued')
    expect(accrued).toBeTruthy()
    expectBalanced(accrued)
    expect(line(accrued, '62100').debit_cents).toBe(103306)
    expect(line(accrued, '15000').debit_cents).toBe(21694)
    expect(line(accrued, '21100').credit_cents).toBe(125000)
  })

  it('groups expense debits per account code across lines', async () => {
    const bill = await createApprovedBill({
      lines: [
        { description: 'Gas', account_code: '61200', tax_rate: 21, amount_incl_cents: 12100 },
        { description: 'Merch', account_code: '51100', tax_rate: 21, amount_incl_cents: 6050 },
      ],
    })
    const accrued = byEvent(await journalsFor(seed.tenantA.id, 'purchase', bill.id), 'accrued')
    expectBalanced(accrued)
    expect(line(accrued, '61200').debit_cents).toBe(10000)
    expect(line(accrued, '51100').debit_cents).toBe(5000)
    expect(line(accrued, '15000').debit_cents).toBe(3150)
    expect(line(accrued, '21100').credit_cents).toBe(18150)
  })

  it('lines without an account_code fall back to the default expense account', async () => {
    const bill = await createApprovedBill({
      lines: [{ description: 'Misc', tax_rate: 21, amount_incl_cents: 12100 }],
    })
    const accrued = byEvent(await journalsFor(seed.tenantA.id, 'purchase', bill.id), 'accrued')
    expect(line(accrued, '62100').debit_cents).toBe(10000) // 62100 = default_expense
  })

  it('rejects an invalid (non-expense) account_code with 400', async () => {
    const res = await asUserA(request(app).post('/api/purchases'))
      .send(purchasePayload({ lines: [{ description: 'x', account_code: '11000', tax_rate: 21, amount_incl_cents: 1000 }] }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_account_code')
  })

  it('bill paid by bank posts DR payable / CR checking', async () => {
    const bill = await createApprovedBill()
    await asUserA(request(app).post(`/api/purchases/${bill.id}/payment`)).send({ paid_on: '2026-06-01' }).expect(200)
    const paid = byEvent(await journalsFor(seed.tenantA.id, 'purchase', bill.id), 'paid')
    expect(paid).toBeTruthy()
    expectBalanced(paid)
    expect(line(paid, '21100').debit_cents).toBe(125000)
    expect(line(paid, '11000').credit_cents).toBe(125000)
  })

  it('bill paid by band member posts to the reimbursement liability and records who fronted it', async () => {
    const bill = await createApprovedBill()
    const res = await asUserA(request(app).post(`/api/purchases/${bill.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: seed.memberA.id, paid_on: '2026-06-01' }).expect(200)
    expect(res.body.payment_method).toBe('member')
    expect(res.body.paid_by_band_member_id).toBe(seed.memberA.id)

    const paid = byEvent(await journalsFor(seed.tenantA.id, 'purchase', bill.id), 'paid')
    expectBalanced(paid)
    expect(line(paid, '21100').debit_cents).toBe(125000)
    expect(line(paid, '22000').credit_cents).toBe(125000)
    expect(line(paid, '11000')).toBeUndefined()
  })

  it('member payment requires the reimbursement account setting', async () => {
    const bill = await createApprovedBill()
    await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ default_reimbursement_account_code: null })
      .expect(200)

    const res = await asUserA(request(app).post(`/api/purchases/${bill.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: seed.memberA.id, paid_on: '2026-06-01' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('accounting_not_configured')
    expect(res.body.field).toBe('default_reimbursement_account_code')
    expect(byEvent(await journalsFor(seed.tenantA.id, 'purchase', bill.id), 'paid')).toBeUndefined()
  })

  it('member payment requires a valid tenant band member', async () => {
    const bill = await createApprovedBill()
    const res = await asUserA(request(app).post(`/api/purchases/${bill.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: seed.memberB.id })
    expect(res.status).toBe(400)
  })

  it('draft bill posts nothing until approved', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(purchasePayload()).expect(201)
    expect(await journalsFor(seed.tenantA.id, 'purchase', r.body.id)).toHaveLength(0)
    await asUserA(request(app).patch(`/api/purchases/${r.body.id}`)).send({ status: 'approved' }).expect(200)
    expect(byEvent(await journalsFor(seed.tenantA.id, 'purchase', r.body.id), 'accrued')).toBeTruthy()
  })
})

// ============================================================
describe('ledger — invariants', () => {
  it('every posted transaction balances', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'sent').expect(200)
    await setInvoiceStatus(inv.id, 'paid').expect(200)
    const bill = await asUserA(request(app).post('/api/purchases')).send(purchasePayload({ status: 'approved' })).expect(201)
    await asUserA(request(app).post(`/api/purchases/${bill.body.id}/payment`)).send({}).expect(200)

    const { rows } = await pool.query(
      `SELECT transaction_id, SUM(debit_cents) d, SUM(credit_cents) c
         FROM ledger_entries WHERE tenant_id = $1 GROUP BY transaction_id`,
      [seed.tenantA.id],
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(Number(r.d)).toBe(Number(r.c))
  })

  it('posting is idempotent per (entity, event)', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'sent').expect(200)
    // bounce back to draft and re-send: the sent journal must not be duplicated
    await setInvoiceStatus(inv.id, 'draft').expect(200)
    await setInvoiceStatus(inv.id, 'sent').expect(200)

    const journals = await journalsFor(seed.tenantA.id, 'invoice', inv.id)
    expect(journals.filter((j) => j.source_event === 'sent')).toHaveLength(1)
  })

  it('tenant isolation: tenant A journals never appear under tenant B', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'sent').expect(200)

    const aJournals = await journalsFor(seed.tenantA.id, 'invoice', inv.id)
    expect(aJournals).toHaveLength(1)
    const bJournals = await journalsFor(seed.tenantB.id, 'invoice', inv.id)
    expect(bJournals).toHaveLength(0)

    const { rows } = await pool.query(
      `SELECT DISTINCT tenant_id FROM ledger_entries
        WHERE transaction_id = $1`,
      [aJournals[0].id],
    )
    expect(rows).toEqual([{ tenant_id: seed.tenantA.id }])
  })

  it('returns 409 accounting_not_configured and writes no rows when a required account is unset', async () => {
    await asUserA(request(app).patch('/api/accounts/settings')).send({ receivable_account_code: null }).expect(200)
    const inv = await createInvoice()
    const res = await setInvoiceStatus(inv.id, 'sent')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('accounting_not_configured')
    expect(await journalsFor(seed.tenantA.id, 'invoice', inv.id)).toHaveLength(0)
  })
})
