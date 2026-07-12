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

afterAll(async () => { await pool.end() })

const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))
const asUserB = (req) => req
  .set('x-test-user-id', String(seed.userB.id))
  .set('x-test-tenant-id', String(seed.tenantB.id))

async function openingBalanceJournal(tenantId) {
  const { rows } = await pool.query(
    `SELECT lt.id, to_char(lt.entry_date,'YYYY-MM-DD') AS entry_date,
            json_agg(json_build_object('code', le.account_code, 'd', le.debit_cents, 'c', le.credit_cents) ORDER BY le.account_code) AS entries
       FROM ledger_transactions lt
       JOIN ledger_entries le ON le.transaction_id = lt.id
      WHERE lt.tenant_id = $1 AND lt.source_type = 'opening_balance' AND lt.source_event = 'set'
      GROUP BY lt.id`,
    [tenantId],
  )
  return rows[0] || null
}

describe('finance-onboarding: opening balance', () => {
  it('status flips once an opening balance is posted; posts DR checking / CR 39000', async () => {
    const before = await asUserA(request(app).get('/api/finance-onboarding/status')).expect(200)
    expect(before.body.openingBalanceSet).toBe(false)

    const res = await asUserA(request(app).post('/api/finance-onboarding/opening-balance'))
      .send({ amount_cents: 500000, entry_date: '2026-01-01' })
      .expect(200)
    expect(res.body.posted).toBe(true)

    const journal = await openingBalanceJournal(seed.tenantA.id)
    expect(journal.entry_date).toBe('2026-01-01')
    expect(journal.entries).toEqual([
      { code: '11000', d: 500000, c: 0 },
      { code: '39000', d: 0, c: 500000 },
    ])

    const after = await asUserA(request(app).get('/api/finance-onboarding/status')).expect(200)
    expect(after.body.openingBalanceSet).toBe(true)
  })

  it('swaps the sides for a negative (overdrawn) opening balance', async () => {
    await asUserA(request(app).post('/api/finance-onboarding/opening-balance'))
      .send({ amount_cents: -25000, entry_date: '2026-01-01' })
      .expect(200)
    const journal = await openingBalanceJournal(seed.tenantA.id)
    expect(journal.entries).toEqual([
      { code: '11000', d: 0, c: 25000 },
      { code: '39000', d: 25000, c: 0 },
    ])
  })

  it('is idempotent per tenant: a second opening balance 409s', async () => {
    await asUserA(request(app).post('/api/finance-onboarding/opening-balance'))
      .send({ amount_cents: 500000, entry_date: '2026-01-01' })
      .expect(200)
    const second = await asUserA(request(app).post('/api/finance-onboarding/opening-balance'))
      .send({ amount_cents: 999900, entry_date: '2026-02-01' })
      .expect(409)
    expect(second.body.code).toBe('opening_balance_exists')
  })

  it('rejects a zero amount', async () => {
    const res = await asUserA(request(app).post('/api/finance-onboarding/opening-balance'))
      .send({ amount_cents: 0, entry_date: '2026-01-01' })
      .expect(400)
    expect(res.body.code).toBe('invalid_amount')
  })

  it('keeps opening balances tenant-isolated', async () => {
    await asUserA(request(app).post('/api/finance-onboarding/opening-balance'))
      .send({ amount_cents: 500000, entry_date: '2026-01-01' })
      .expect(200)

    // Tenant B still has none.
    const bStatus = await asUserB(request(app).get('/api/finance-onboarding/status')).expect(200)
    expect(bStatus.body.openingBalanceSet).toBe(false)
    expect(await openingBalanceJournal(seed.tenantB.id)).toBeNull()
  })
})

describe('tutorials: dismissal', () => {
  it('records a dismissed tutorial and exposes it on /auth/me', async () => {
    const before = await asUserA(request(app).get('/api/auth/me')).expect(200)
    expect(before.body.dismissedTutorials).toEqual([])

    await asUserA(request(app).post('/api/tutorials/finance_welcome/dismiss')).expect(204)

    const after = await asUserA(request(app).get('/api/auth/me')).expect(200)
    expect(after.body.dismissedTutorials).toContain('finance_welcome')
  })

  it('is idempotent and per-user (does not affect another user)', async () => {
    await asUserA(request(app).post('/api/tutorials/finance_welcome/dismiss')).expect(204)
    await asUserA(request(app).post('/api/tutorials/finance_welcome/dismiss')).expect(204)

    const b = await asUserB(request(app).get('/api/auth/me')).expect(200)
    expect(b.body.dismissedTutorials).toEqual([])
  })

  it('rejects a malformed tutorial key', async () => {
    await asUserA(request(app).post('/api/tutorials/Bad Key!/dismiss')).expect(400)
  })
})
