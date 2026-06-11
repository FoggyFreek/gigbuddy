import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

// Stub MinIO so any storage path is a no-op (we assert DB/ledger state only).
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

// asUserA/asUserB are file-local (the repo defines them per server test file).
function asUserA(req) {
  return req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))
}
function asUserB(req) {
  return req.set('x-test-user-id', String(seed.userB.id)).set('x-test-tenant-id', String(seed.tenantB.id))
}

// ---------- helpers ----------

function draftPayload(overrides = {}) {
  return {
    entry_date: '2026-06-09',
    description: 'Test journal',
    lines: [],
    ...overrides,
  }
}

async function createDraft(overrides) {
  const r = await asUserA(request(app).post('/api/journal')).send(draftPayload(overrides)).expect(201)
  return r.body
}

async function ledgerEntriesFor(tenantId, journalId) {
  const { rows: txns } = await pool.query(
    `SELECT * FROM ledger_transactions
      WHERE tenant_id = $1 AND source_type = 'journal' AND source_id = $2 ORDER BY id`,
    [tenantId, journalId],
  )
  const out = []
  for (const t of txns) {
    const { rows: entries } = await pool.query(
      `SELECT account_code, debit_cents, credit_cents FROM ledger_entries
        WHERE transaction_id = $1 ORDER BY id`,
      [t.id],
    )
    out.push({ ...t, entries })
  }
  return out
}

const leg = (entries, code) => entries.find((e) => e.account_code === code)
const sumDebit = (entries) => entries.reduce((s, e) => s + e.debit_cents, 0)
const sumCredit = (entries) => entries.reduce((s, e) => s + e.credit_cents, 0)

async function countLedgerRows(tenantId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0].n
}

// ============================================================
// CRUD + numbering
// ============================================================

describe('journal CRUD', () => {
  it('creates a draft with an auto entry_number and lists it', async () => {
    const draft = await createDraft()
    expect(draft.status).toBe('draft')
    expect(draft.entry_number).toBeGreaterThan(0)

    const list = await asUserA(request(app).get('/api/journal')).expect(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].id).toBe(draft.id)
  })

  it('assigns unique gap-free entry numbers under concurrent creation', async () => {
    const reqs = Array.from({ length: 6 }, () =>
      asUserA(request(app).post('/api/journal')).send(draftPayload()))
    const results = await Promise.all(reqs)
    const numbers = results.map((r) => r.body.entry_number).sort((a, b) => a - b)
    expect(new Set(numbers).size).toBe(6)
    // gap-free run starting at 1
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('updates a draft (header + lines)', async () => {
    const draft = await createDraft()
    const r = await asUserA(request(app).patch(`/api/journal/${draft.id}`)).send({
      description: 'Updated',
      lines: [{ description: 'l1', account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 5000, position: 0 }],
    }).expect(200)
    expect(r.body.description).toBe('Updated')
    expect(r.body.lines).toHaveLength(1)
    expect(r.body.lines[0].account_code).toBe('62100')
  })

  it('deletes a draft', async () => {
    const draft = await createDraft()
    await asUserA(request(app).delete(`/api/journal/${draft.id}`)).expect(204)
    await asUserA(request(app).get(`/api/journal/${draft.id}`)).expect(404)
  })
})

// ============================================================
// Draft normalization vs approve-time validation
// ============================================================

describe('draft normalization', () => {
  it('saves half-filled rows (missing account/side, zero amount)', async () => {
    const draft = await createDraft()
    const r = await asUserA(request(app).patch(`/api/journal/${draft.id}`)).send({
      lines: [{ description: 'wip', vat_rate: 21, amount_cents: 0, position: 0 }],
    }).expect(200)
    expect(r.body.lines).toHaveLength(1)
    expect(r.body.lines[0].account_code).toBeNull()
    expect(r.body.lines[0].side).toBeNull()
  })

  it('rejects a non-existent account_code with a clean 400 (not an FK error)', async () => {
    const draft = await createDraft()
    const r = await asUserA(request(app).patch(`/api/journal/${draft.id}`)).send({
      lines: [{ account_code: '99999', vat_rate: 0, side: 'debit', amount_cents: 100, position: 0 }],
    }).expect(400)
    expect(r.body.code).toBe('unknown_account_code')
  })

  it('allows an inactive-but-existing account on a draft', async () => {
    await pool.query(
      `UPDATE chart_of_accounts SET is_active = false WHERE tenant_id = $1 AND code = '62200'`,
      [seed.tenantA.id],
    )
    const draft = await createDraft()
    await asUserA(request(app).patch(`/api/journal/${draft.id}`)).send({
      lines: [{ account_code: '62200', vat_rate: 0, side: 'debit', amount_cents: 100, position: 0 }],
    }).expect(200)
  })
})

// ============================================================
// Approve → ledger posting
// ============================================================

describe('approve posts to the ledger', () => {
  it('posts net/VAT/balancing legs for a one-row debit entry (input VAT)', async () => {
    const draft = await createDraft({
      lines: [{ description: 'Gear', account_code: '62100', vat_rate: 21, side: 'debit', amount_cents: 12100, balancing_account_code: '11000', position: 0 }],
    })
    const r = await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(200)
    expect(r.body.status).toBe('approved')
    expect(r.body.posted_transaction_id).toBeTruthy()

    const [txn] = await ledgerEntriesFor(seed.tenantA.id, draft.id)
    expect(leg(txn.entries, '62100').debit_cents).toBe(10000)
    expect(leg(txn.entries, '15000').debit_cents).toBe(2100) // input VAT
    expect(leg(txn.entries, '11000').credit_cents).toBe(12100) // balancing
    expect(sumDebit(txn.entries)).toBe(sumCredit(txn.entries))
  })

  it('posts output VAT for a credit-side entry', async () => {
    const draft = await createDraft({
      lines: [{ account_code: '41000', vat_rate: 21, side: 'credit', amount_cents: 12100, balancing_account_code: '11000', position: 0 }],
    })
    await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(200)
    const [txn] = await ledgerEntriesFor(seed.tenantA.id, draft.id)
    expect(leg(txn.entries, '41000').credit_cents).toBe(10000)
    expect(leg(txn.entries, '24000').credit_cents).toBe(2100) // output VAT
    expect(leg(txn.entries, '11000').debit_cents).toBe(12100)
  })

  it('posts a balanced multi-line entry without balancing accounts', async () => {
    const draft = await createDraft({
      lines: [
        { account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 10000, position: 0 },
        { account_code: '11000', vat_rate: 0, side: 'credit', amount_cents: 10000, position: 1 },
      ],
    })
    await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(200)
    const [txn] = await ledgerEntriesFor(seed.tenantA.id, draft.id)
    expect(sumDebit(txn.entries)).toBe(10000)
    expect(sumCredit(txn.entries)).toBe(10000)
  })

  it('rejects an unbalanced multi-line entry with 400 and writes no ledger rows', async () => {
    const draft = await createDraft({
      lines: [
        { account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 10000, position: 0 },
        { account_code: '11000', vat_rate: 0, side: 'credit', amount_cents: 5000, position: 1 },
      ],
    })
    const r = await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(400)
    expect(r.body.code).toBe('unbalanced_journal')
    expect(await countLedgerRows(seed.tenantA.id)).toBe(0)
    const reread = await asUserA(request(app).get(`/api/journal/${draft.id}`)).expect(200)
    expect(reread.body.status).toBe('draft')
  })
})

// ============================================================
// Approve-time posting validation (unpostable lines)
// ============================================================

describe('approve-time posting validation', () => {
  const cases = [
    ['missing account', { vat_rate: 0, side: 'debit', amount_cents: 100 }, 'invalid_account_code'],
    ['missing side', { account_code: '62100', vat_rate: 0, amount_cents: 100 }, 'missing_side'],
    ['zero amount', { account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 0 }, 'invalid_amount'],
  ]
  for (const [name, badLine, code] of cases) {
    it(`rejects ${name} with 400 and no ledger rows`, async () => {
      const draft = await createDraft({
        lines: [
          { ...badLine, position: 0 },
          { account_code: '11000', vat_rate: 0, side: 'credit', amount_cents: 100, position: 1 },
        ],
      })
      const r = await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(400)
      expect(r.body.code).toBe(code)
      expect(await countLedgerRows(seed.tenantA.id)).toBe(0)
    })
  }

  it('rejects an inactive account at approve time', async () => {
    const draft = await createDraft({
      lines: [{ account_code: '62200', vat_rate: 0, side: 'debit', amount_cents: 10000, balancing_account_code: '11000', position: 0 }],
    })
    await pool.query(
      `UPDATE chart_of_accounts SET is_active = false WHERE tenant_id = $1 AND code = '62200'`,
      [seed.tenantA.id],
    )
    const r = await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(400)
    expect(r.body.code).toBe('invalid_account_code')
    expect(await countLedgerRows(seed.tenantA.id)).toBe(0)
  })

  it('rejects a stale/inactive balancing account at approve time', async () => {
    const draft = await createDraft({
      lines: [{ account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 10000, balancing_account_code: '62200', position: 0 }],
    })
    await pool.query(
      `UPDATE chart_of_accounts SET is_active = false WHERE tenant_id = $1 AND code = '62200'`,
      [seed.tenantA.id],
    )
    const r = await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(400)
    expect(r.body.code).toBe('invalid_balancing_account')
  })

  it('returns 409 when a required VAT account is not configured, writing no ledger rows', async () => {
    await pool.query(
      `UPDATE tenant_accounting_settings SET input_vat_account_code = NULL WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    const draft = await createDraft({
      lines: [{ account_code: '62100', vat_rate: 21, side: 'debit', amount_cents: 12100, balancing_account_code: '11000', position: 0 }],
    })
    const r = await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(409)
    expect(r.body.code).toBe('accounting_not_configured')
    expect(await countLedgerRows(seed.tenantA.id)).toBe(0)
  })
})

// ============================================================
// Locking after approval + idempotency
// ============================================================

describe('approved journals are locked and idempotent', () => {
  async function approvedDraft() {
    const draft = await createDraft({
      lines: [{ account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 10000, balancing_account_code: '11000', position: 0 }],
    })
    await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(200)
    return draft
  }

  it('rejects edit and delete of an approved journal with 409', async () => {
    const draft = await approvedDraft()
    await asUserA(request(app).patch(`/api/journal/${draft.id}`)).send({ description: 'x' }).expect(409)
    await asUserA(request(app).delete(`/api/journal/${draft.id}`)).expect(409)
  })

  it('returns 409 on a second (sequential) approve and posts exactly one transaction', async () => {
    const draft = await approvedDraft()
    await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(409)
    const txns = await ledgerEntriesFor(seed.tenantA.id, draft.id)
    expect(txns).toHaveLength(1)
  })

  it('posts exactly one transaction under concurrent approve', async () => {
    const draft = await createDraft({
      lines: [{ account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 10000, balancing_account_code: '11000', position: 0 }],
    })
    const results = await Promise.allSettled([
      asUserA(request(app).post(`/api/journal/${draft.id}/approve`)),
      asUserA(request(app).post(`/api/journal/${draft.id}/approve`)),
    ])
    const statuses = results.map((r) => r.value?.status).sort()
    expect(statuses).toEqual([200, 409])
    const txns = await ledgerEntriesFor(seed.tenantA.id, draft.id)
    expect(txns).toHaveLength(1)

    const reread = await asUserA(request(app).get(`/api/journal/${draft.id}`)).expect(200)
    expect(reread.body.posted_transaction_id).toBeTruthy()
  })
})

// ============================================================
// Approve all (batch) + dedup
// ============================================================

describe('approve all', () => {
  it('approves selected drafts and dedups duplicate ids', async () => {
    const postable = () => ({
      lines: [{ account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 10000, balancing_account_code: '11000', position: 0 }],
    })
    const a = await createDraft(postable())
    const b = await createDraft(postable())
    const r = await asUserA(request(app).post('/api/journal/approve')).send({ ids: [a.id, b.id, a.id] }).expect(200)
    const ok = r.body.results.filter((x) => x.ok).map((x) => x.id).sort((m, n) => m - n)
    expect(ok).toEqual([a.id, b.id].sort((m, n) => m - n))
    expect(r.body.results).toHaveLength(2) // a.id appears once
    expect((await ledgerEntriesFor(seed.tenantA.id, a.id))).toHaveLength(1)
    expect((await ledgerEntriesFor(seed.tenantA.id, b.id))).toHaveLength(1)
  })
})

// ============================================================
// Tenant isolation
// ============================================================

describe('tenant isolation', () => {
  it('hides tenant A journals from tenant B and 404s cross-tenant access', async () => {
    const draft = await createDraft()

    const list = await asUserB(request(app).get('/api/journal')).expect(200)
    expect(list.body).toHaveLength(0)

    await asUserB(request(app).get(`/api/journal/${draft.id}`)).expect(404)
    await asUserB(request(app).patch(`/api/journal/${draft.id}`)).send({ description: 'hijack' }).expect(404)
    await asUserB(request(app).post(`/api/journal/${draft.id}/approve`)).expect(404)
    await asUserB(request(app).delete(`/api/journal/${draft.id}`)).expect(404)
  })

  it('does not expose an approved tenant A journal to tenant B', async () => {
    const draft = await createDraft({
      lines: [{ account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 10000, balancing_account_code: '11000', position: 0 }],
    })
    await asUserA(request(app).post(`/api/journal/${draft.id}/approve`)).expect(200)
    const list = await asUserB(request(app).get('/api/journal')).expect(200)
    expect(list.body).toHaveLength(0)
  })
})
