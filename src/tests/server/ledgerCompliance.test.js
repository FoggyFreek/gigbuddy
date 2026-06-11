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

// ---------- fixtures ----------

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
    lines: [{ description: 'Studio day', tax_rate: 21, amount_incl_cents: 125000 }],
    ...overrides,
  }
}

async function createInvoice(overrides) {
  const r = await asUserA(request(app).post('/api/invoices')).send(invoicePayload(overrides)).expect(201)
  return r.body
}

async function createPurchase(overrides) {
  const r = await asUserA(request(app).post('/api/purchases')).send(purchasePayload(overrides)).expect(201)
  return r.body
}

function setInvoiceStatus(id, status) {
  return asUserA(request(app).patch(`/api/invoices/${id}`)).send({ status })
}

function setPurchaseStatus(id, status) {
  return asUserA(request(app).patch(`/api/purchases/${id}`)).send({ status })
}

function journalPayload(overrides = {}) {
  return {
    entry_date: '2026-06-01',
    description: 'manual posting',
    lines: [{
      description: 'cash correction', account_code: '11000', vat_rate: 0,
      side: 'debit', amount_cents: 1000, balancing_account_code: '33000',
    }],
    ...overrides,
  }
}

// ============================================================
describe('forward-only invoice status transitions', () => {
  it.each([
    ['sent', 'draft'],
    ['paid', 'draft'],
    ['paid', 'sent'],
  ])('blocks %s → %s with 409 invalid_status_transition', async (from, to) => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, from).expect(200)
    const res = await setInvoiceStatus(inv.id, to)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('invalid_status_transition')
    expect(res.body.from).toBe(from)
    expect(res.body.to).toBe(to)
    const { rows } = await pool.query('SELECT status FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe(from)
  })

  it('blocks void → sent', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'void').expect(200)
    const res = await setInvoiceStatus(inv.id, 'sent')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('invalid_status_transition')
  })

  it('still rejects paid → void with cannot_void_paid_invoice', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'paid').expect(200)
    const res = await setInvoiceStatus(inv.id, 'void')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('cannot_void_paid_invoice')
  })

  it('allows same-status PATCH (no-op) and legal transitions', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'sent').expect(200)
    await setInvoiceStatus(inv.id, 'sent').expect(200)
    await setInvoiceStatus(inv.id, 'paid').expect(200)
  })
})

describe('forward-only purchase status transitions', () => {
  it('blocks approved → draft with 409 invalid_status_transition', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)
    const res = await setPurchaseStatus(p.id, 'draft')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('invalid_status_transition')
    const { rows } = await pool.query('SELECT status FROM purchases WHERE id = $1', [p.id])
    expect(rows[0].status).toBe('approved')
  })

  it('blocks paid → draft and paid → approved via PATCH', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)
    await asUserA(request(app).post(`/api/purchases/${p.id}/payment`)).send({ paid_on: '2026-06-01' }).expect(200)
    for (const to of ['draft', 'approved']) {
      const res = await setPurchaseStatus(p.id, to)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('invalid_status_transition')
    }
  })

  it('allows draft → approved and same-status PATCH', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'draft').expect(200)
    await setPurchaseStatus(p.id, 'approved').expect(200)
  })
})

// ============================================================
describe('actor audit trail', () => {
  it('stamps created_by/approved_by on a purchase and its ledger transactions', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)
    await asUserA(request(app).post(`/api/purchases/${p.id}/payment`)).send({ paid_on: '2026-06-01' }).expect(200)

    const { rows } = await pool.query('SELECT * FROM purchases WHERE id = $1', [p.id])
    expect(rows[0].created_by_user_id).toBe(seed.userA.id)
    expect(rows[0].approved_by_user_id).toBe(seed.userA.id)
    expect(rows[0].payment_registered_by_user_id).toBe(seed.userA.id)

    const { rows: txns } = await pool.query(
      `SELECT created_by_user_id FROM ledger_transactions
        WHERE tenant_id = $1 AND source_type = 'purchase' AND source_id = $2`,
      [seed.tenantA.id, p.id],
    )
    expect(txns.length).toBe(2) // accrued + paid
    for (const t of txns) expect(t.created_by_user_id).toBe(seed.userA.id)
  })

  it('stamps approved_by when a purchase is created directly as approved', async () => {
    const p = await createPurchase({ status: 'approved' })
    const { rows } = await pool.query('SELECT * FROM purchases WHERE id = $1', [p.id])
    expect(rows[0].created_by_user_id).toBe(seed.userA.id)
    expect(rows[0].approved_by_user_id).toBe(seed.userA.id)
  })

  it('stamps created_by on an invoice and actor on its ledger transactions', async () => {
    const inv = await createInvoice()
    const { rows } = await pool.query('SELECT created_by_user_id FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].created_by_user_id).toBe(seed.userA.id)

    await setInvoiceStatus(inv.id, 'sent').expect(200)
    const { rows: txns } = await pool.query(
      `SELECT created_by_user_id FROM ledger_transactions
        WHERE tenant_id = $1 AND source_type = 'invoice' AND source_id = $2`,
      [seed.tenantA.id, inv.id],
    )
    expect(txns.length).toBe(1)
    expect(txns[0].created_by_user_id).toBe(seed.userA.id)
  })

  it('stamps created_by/approved_by/approved_at on a journal', async () => {
    const create = await asUserA(request(app).post('/api/journal')).send(journalPayload()).expect(201)
    await asUserA(request(app).post(`/api/journal/${create.body.id}/approve`)).send().expect(200)

    const { rows } = await pool.query('SELECT * FROM journals WHERE id = $1', [create.body.id])
    expect(rows[0].created_by_user_id).toBe(seed.userA.id)
    expect(rows[0].approved_by_user_id).toBe(seed.userA.id)
    expect(rows[0].approved_at).not.toBeNull()
  })

  it('stamps created_by on a reimbursement', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)
    await asUserA(request(app).post(`/api/purchases/${p.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: seed.memberA.id, paid_on: '2026-06-01' }).expect(200)

    const r = await asUserA(request(app).post('/api/reimbursements'))
      .send({ band_member_id: seed.memberA.id, purchase_ids: [p.id], paid_on: '2026-06-05' }).expect(201)
    const { rows } = await pool.query('SELECT created_by_user_id FROM reimbursements WHERE id = $1', [r.body.id])
    expect(rows[0].created_by_user_id).toBe(seed.userA.id)
  })
})

// ============================================================
describe('settings guard — account codes with open balances', () => {
  it('refuses changing payable_account_code while approved unpaid purchases exist', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)

    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ payable_account_code: '21200' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('account_has_open_balance')
    expect(res.body.field).toBe('payable_account_code')
  })

  it('allows changing payable_account_code after all bills are paid', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)
    await asUserA(request(app).post(`/api/purchases/${p.id}/payment`)).send({ paid_on: '2026-06-01' }).expect(200)

    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ payable_account_code: '21200' })
    expect(res.status).toBe(200)
    expect(res.body.payable_account_code).toBe('21200')
  })

  it('refuses changing default_reimbursement_account_code while member debt is outstanding, allows after settling', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)
    await asUserA(request(app).post(`/api/purchases/${p.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: seed.memberA.id, paid_on: '2026-06-01' }).expect(200)

    const blocked = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ default_reimbursement_account_code: '21200' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('account_has_open_balance')

    await asUserA(request(app).post(`/api/reimbursements/members/${seed.memberA.id}/full`))
      .send({ paid_on: '2026-06-05' }).expect(201)

    const allowed = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ default_reimbursement_account_code: '21200' })
    expect(allowed.status).toBe(200)
  })

  it('refuses changing receivable_account_code while sent unpaid invoices exist', async () => {
    const inv = await createInvoice()
    await setInvoiceStatus(inv.id, 'sent').expect(200)

    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ receivable_account_code: '12000' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('account_has_open_balance')
  })

  it('re-sending the same code is a no-op and allowed despite open balances', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)
    const { rows } = await pool.query(
      'SELECT payable_account_code FROM tenant_accounting_settings WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ payable_account_code: rows[0].payable_account_code })
    expect(res.status).toBe(200)
  })
})

// ============================================================
describe('period close — books_closed_through', () => {
  async function closeBooksThrough(date) {
    await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ books_closed_through: date }).expect(200)
  }

  it('can be set and cleared via the settings PATCH', async () => {
    const set = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ books_closed_through: '2026-05-31' })
    expect(set.status).toBe(200)
    expect(String(set.body.books_closed_through)).toContain('2026-05-31')

    const cleared = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ books_closed_through: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.books_closed_through).toBeNull()
  })

  it('rejects an invalid books_closed_through value', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ books_closed_through: 'not-a-date' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_books_closed_through')
  })

  it('rejects approving a journal dated inside the closed period with 409 period_closed', async () => {
    await closeBooksThrough('2026-06-30')
    const create = await asUserA(request(app).post('/api/journal'))
      .send(journalPayload({ entry_date: '2026-06-15' })).expect(201)
    const res = await asUserA(request(app).post(`/api/journal/${create.body.id}/approve`)).send()
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('period_closed')

    // Journal stays draft, nothing posted.
    const { rows } = await pool.query('SELECT status FROM journals WHERE id = $1', [create.body.id])
    expect(rows[0].status).toBe('draft')
  })

  it('allows approving a journal dated after the closed period', async () => {
    await closeBooksThrough('2026-06-30')
    const create = await asUserA(request(app).post('/api/journal'))
      .send(journalPayload({ entry_date: '2026-07-01' })).expect(201)
    await asUserA(request(app).post(`/api/journal/${create.body.id}/approve`)).send().expect(200)
  })

  it('rejects registering a purchase payment dated inside the closed period and rolls everything back', async () => {
    const p = await createPurchase()
    await setPurchaseStatus(p.id, 'approved').expect(200)
    await closeBooksThrough('2026-06-30')

    const res = await asUserA(request(app).post(`/api/purchases/${p.id}/payment`)).send({ paid_on: '2026-06-15' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('period_closed')

    // Status flip rolled back with the journal.
    const { rows } = await pool.query('SELECT status, paid_at FROM purchases WHERE id = $1', [p.id])
    expect(rows[0].status).toBe('approved')
    expect(rows[0].paid_at).toBeNull()
  })

  it('rejects approving a bill whose receipt_date falls in the closed period', async () => {
    const p = await createPurchase({ receipt_date: '2026-05-01' })
    await closeBooksThrough('2026-06-30')
    const res = await setPurchaseStatus(p.id, 'approved')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('period_closed')
  })

  it('rejects sending an invoice whose issue_date falls in the closed period', async () => {
    const inv = await createInvoice({ issue_date: '2026-05-01' })
    await closeBooksThrough('2026-06-30')
    const res = await setInvoiceStatus(inv.id, 'sent')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('period_closed')
  })
})
