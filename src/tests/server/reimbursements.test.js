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
  return req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))
}

function asUserB(req) {
  return req.set('x-test-user-id', String(seed.userB.id)).set('x-test-tenant-id', String(seed.tenantB.id))
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

// ---------- fixtures ----------

const REIMBURSEMENT_CODE = '22000' // seeded default_reimbursement_account_code
const CHECKING_CODE = '11000'      // seeded primary_checking_account_code

function purchasePayload(overrides = {}) {
  return {
    supplier_name: 'mi5 Studios',
    receipt_date: '2026-05-01',
    lines: [{ description: 'Studio day', tax_rate: 21, amount_incl_cents: 125000 }],
    ...overrides,
  }
}

// Creates a member-paid, paid purchase fronted by `memberId`. Returns the purchase row.
async function memberPaidPurchase(memberId, asUser, overrides = {}) {
  const created = await asUser(request(app).post('/api/purchases')).send(purchasePayload(overrides)).expect(201)
  await asUser(request(app).patch(`/api/purchases/${created.body.id}`)).send({ status: 'approved' }).expect(200)
  const paid = await asUser(request(app).post(`/api/purchases/${created.body.id}/payment`))
    .send({ method: 'member', paid_by_band_member_id: memberId, paid_on: '2026-06-01' }).expect(200)
  return paid.body
}

describe('reimbursements — outstanding', () => {
  it('aggregates a member’s unsettled member-paid purchases', async () => {
    await memberPaidPurchase(seed.memberA.id, asUserA, { lines: [{ description: 'a', tax_rate: 21, amount_incl_cents: 125000 }] })
    await memberPaidPurchase(seed.memberA.id, asUserA, { lines: [{ description: 'b', tax_rate: 21, amount_incl_cents: 50000 }] })

    const res = await asUserA(request(app).get('/api/reimbursements/outstanding')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].band_member_id).toBe(seed.memberA.id)
    expect(res.body[0].outstanding_cents).toBe(175000)
    expect(res.body[0].outstanding_count).toBe(2)
  })

  it('excludes bank-paid purchases from outstanding', async () => {
    const created = await asUserA(request(app).post('/api/purchases')).send(purchasePayload()).expect(201)
    await asUserA(request(app).patch(`/api/purchases/${created.body.id}`)).send({ status: 'approved' }).expect(200)
    await asUserA(request(app).post(`/api/purchases/${created.body.id}/payment`)).send({ paid_on: '2026-06-01' }).expect(200)

    const res = await asUserA(request(app).get('/api/reimbursements/outstanding')).expect(200)
    expect(res.body).toHaveLength(0)
  })

  it('lists a member’s outstanding purchases for the expand panel', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    const res = await asUserA(request(app).get(`/api/reimbursements/members/${seed.memberA.id}/purchases`)).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(p.id)
    expect(res.body[0].total_cents).toBe(125000)
    expect(res.body[0].description).toBe('Studio day')
  })
})

describe('reimbursements — register', () => {
  it('settles selected purchases and posts a balanced journal', async () => {
    const p1 = await memberPaidPurchase(seed.memberA.id, asUserA, { lines: [{ description: 'a', tax_rate: 21, amount_incl_cents: 125000 }] })
    const p2 = await memberPaidPurchase(seed.memberA.id, asUserA, { lines: [{ description: 'b', tax_rate: 21, amount_incl_cents: 50000 }] })

    const res = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p1.id, p2.id], paid_on: '2026-06-15', memo: 'June gear' })
      .expect(201)
    expect(res.body.amount_cents).toBe(175000)
    expect(res.body.band_member_id).toBe(seed.memberA.id)

    const paid = byEvent(await journalsFor(seed.tenantA.id, 'reimbursement', res.body.id), 'paid')
    expectBalanced(paid)
    expect(line(paid, REIMBURSEMENT_CODE).debit_cents).toBe(175000)
    expect(line(paid, CHECKING_CODE).credit_cents).toBe(175000)

    // Both purchases are now settled and drop out of outstanding.
    const outstanding = await asUserA(request(app).get('/api/reimbursements/outstanding')).expect(200)
    expect(outstanding.body).toHaveLength(0)
  })

  it('links the settled purchases to the reimbursement row', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    const res = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id] }).expect(201)

    const { rows } = await pool.query('SELECT reimbursement_id FROM purchases WHERE id = $1', [p.id])
    expect(rows[0].reimbursement_id).toBe(res.body.id)
  })

  it('reimburses a member’s full outstanding balance', async () => {
    await memberPaidPurchase(seed.memberA.id, asUserA, { lines: [{ description: 'a', tax_rate: 21, amount_incl_cents: 125000 }] })
    await memberPaidPurchase(seed.memberA.id, asUserA, { lines: [{ description: 'b', tax_rate: 21, amount_incl_cents: 50000 }] })

    const res = await asUserA(request(app).post(`/api/reimbursements/members/${seed.memberA.id}/full`))
      .send({ paid_on: '2026-06-15' }).expect(201)
    expect(res.body.amount_cents).toBe(175000)

    const outstanding = await asUserA(request(app).get('/api/reimbursements/outstanding')).expect(200)
    expect(outstanding.body).toHaveLength(0)
  })

  it('rejects a full reimbursement when nothing is outstanding', async () => {
    const res = await asUserA(request(app).post(`/api/reimbursements/members/${seed.memberA.id}/full`)).send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('nothing_outstanding')
  })

  it('is idempotent on its source key (journal posts once)', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    const res = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id] }).expect(201)

    const journals = await journalsFor(seed.tenantA.id, 'reimbursement', res.body.id)
    expect(journals.filter((j) => j.source_event === 'paid')).toHaveLength(1)
  })
})

describe('reimbursements — validation', () => {
  it('rejects an empty purchase selection with 400', async () => {
    const res = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [] })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('no_purchases_selected')
  })

  it('rejects an invalid band member with 400', async () => {
    const res = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: 999999, purchase_ids: [1] })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_band_member')
  })

  it('rejects a bad paid_on with 400', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    const res = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id], paid_on: 'not-a-date' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_date')
  })

  it('rejects settling a purchase fronted by a different member', async () => {
    // Two members in tenant A; the purchase is fronted by memberA.
    const { rows: [other] } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order) VALUES ($1, 'Other', 'sub', 5) RETURNING id`,
      [seed.tenantA.id],
    )
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    const res = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: other.id, purchase_ids: [p.id] })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('purchase_not_outstanding')
  })

  it('rejects settling an already-settled purchase', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id] }).expect(201)
    const again = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id] })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('purchase_not_outstanding')
  })
})

describe('reimbursements — accounting not configured', () => {
  it('returns 409 and rolls back (no row, no settlement)', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    // Clear the reimbursement liability account so posting can't resolve it.
    await pool.query(
      'UPDATE tenant_accounting_settings SET default_reimbursement_account_code = NULL WHERE tenant_id = $1',
      [seed.tenantA.id],
    )

    const res = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id] })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('accounting_not_configured')

    const { rows: reimb } = await pool.query('SELECT 1 FROM reimbursements WHERE tenant_id = $1', [seed.tenantA.id])
    expect(reimb).toHaveLength(0)
    const { rows: purch } = await pool.query('SELECT reimbursement_id FROM purchases WHERE id = $1', [p.id])
    expect(purch[0].reimbursement_id).toBeNull()
  })
})

describe('reimbursements — isolation', () => {
  it('does not leak another tenant’s outstanding or member purchases', async () => {
    await memberPaidPurchase(seed.memberA.id, asUserA)

    const bOutstanding = await asUserB(request(app).get('/api/reimbursements/outstanding')).expect(200)
    expect(bOutstanding.body).toHaveLength(0)

    // Tenant B cannot read tenant A's member purchases.
    const foreign = await asUserB(request(app).get(`/api/reimbursements/members/${seed.memberA.id}/purchases`))
    expect(foreign.status).toBe(404)
  })

  it('rejects reimbursing a cross-tenant band member', async () => {
    const res = await asUserB(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [1] })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_band_member')
  })

  it('history lists only the active tenant’s reimbursements', async () => {
    const pA = await memberPaidPurchase(seed.memberA.id, asUserA)
    await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [pA.id] }).expect(201)

    const a = await asUserA(request(app).get('/api/reimbursements')).expect(200)
    expect(a.body).toHaveLength(1)
    const b = await asUserB(request(app).get('/api/reimbursements')).expect(200)
    expect(b.body).toHaveLength(0)
  })
})

describe('reimbursements — history', () => {
  it('returns past reimbursements with their settled purchases and available periods', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    const created = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id], paid_on: '2026-06-15', memo: 'gear' }).expect(201)

    const history = await asUserA(request(app).get('/api/reimbursements')).expect(200)
    expect(history.body).toHaveLength(1)
    expect(history.body[0].id).toBe(created.body.id)
    expect(history.body[0].band_member_name).toBe('Alpha Member')
    expect(history.body[0].paid_on).toBe('2026-06-15')
    expect(history.body[0].purchases).toHaveLength(1)
    expect(history.body[0].purchases[0].id).toBe(p.id)

    const periods = await asUserA(request(app).get('/api/reimbursements/periods')).expect(200)
    expect(periods.body).toContain('2026-06-15')
  })

  it('filters history by period', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id], paid_on: '2026-06-15' }).expect(201)

    const inJune = await asUserA(request(app).get('/api/reimbursements?mode=month&year=2026&month=5')).expect(200)
    expect(inJune.body).toHaveLength(1)
    const inMay = await asUserA(request(app).get('/api/reimbursements?mode=month&year=2026&month=4')).expect(200)
    expect(inMay.body).toHaveLength(0)
  })

  it('rejects re-paying a reimbursed purchase with 409 purchase_reimbursed', async () => {
    const p = await memberPaidPurchase(seed.memberA.id, asUserA)
    await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id] }).expect(201)

    const res = await asUserA(request(app).post(`/api/purchases/${p.id}/payment`))
      .send({ method: 'bank', paid_on: '2026-07-01' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('purchase_reimbursed')
  })
})
