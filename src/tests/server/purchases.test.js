import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed
let contactA, contactB

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
  contactB = seed.contacts.find((c) => c.tenant_id === seed.tenantB.id)
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

function asUserB(req) {
  return req
    .set('x-test-user-id', String(seed.userB.id))
    .set('x-test-tenant-id', String(seed.tenantB.id))
}

function basePayload(overrides = {}) {
  return {
    supplier_name: 'mi5 Studios',
    receipt_date: '2026-05-01',
    lines: [
      { description: 'Studio recording day', expense_category: 'Equipment', tax_rate: 21, amount_incl_cents: 125000 },
    ],
    ...overrides,
  }
}

async function approve(id, asUser) {
  return asUser(request(app).patch(`/api/purchases/${id}`)).send({ status: 'approved' }).expect(200)
}

describe('purchases — isolation', () => {
  it('list returns only the active tenant', async () => {
    await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await asUserB(request(app).post('/api/purchases')).send(basePayload({ supplier_name: 'Beta Supplier' })).expect(201)

    const a = await asUserA(request(app).get('/api/purchases')).expect(200)
    const b = await asUserB(request(app).get('/api/purchases')).expect(200)
    expect(a.body).toHaveLength(1)
    expect(a.body[0].supplier_name).toBe('mi5 Studios')
    expect(b.body).toHaveLength(1)
    expect(b.body[0].supplier_name).toBe('Beta Supplier')
  })

  it('list includes the first line description', async () => {
    await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const a = await asUserA(request(app).get('/api/purchases')).expect(200)
    expect(a.body[0].description).toBe('Studio recording day')
  })

  it('cross-tenant get returns 404, owner still 200', async () => {
    const created = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const foreign = await asUserB(request(app).get(`/api/purchases/${created.body.id}`))
    expect(foreign.status).toBe(404)
    const owner = await asUserA(request(app).get(`/api/purchases/${created.body.id}`)).expect(200)
    expect(owner.body.id).toBe(created.body.id)
  })

  it('cross-tenant supplier_contact_id rejected with 400 (create)', async () => {
    const res = await asUserA(request(app).post('/api/purchases'))
      .send(basePayload({ supplier_contact_id: contactB.id }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/supplier_contact_id/i)
  })

  it('same-tenant supplier_contact_id accepted', async () => {
    const res = await asUserA(request(app).post('/api/purchases'))
      .send(basePayload({ supplier_contact_id: contactA.id }))
    expect(res.status).toBe(201)
    expect(res.body.supplier_contact_id).toBe(contactA.id)
  })

  it('cross-tenant supplier_contact_id rejected with 400 (patch)', async () => {
    const created = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const res = await asUserA(request(app).patch(`/api/purchases/${created.body.id}`))
      .send({ supplier_contact_id: contactB.id })
    expect(res.status).toBe(400)
  })
})

describe('purchases — receipt numbering', () => {
  it('produces sequential numbers per tenant', async () => {
    const r1 = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const r2 = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    expect(r1.body.receipt_number).toBe(1)
    expect(r2.body.receipt_number).toBe(2)
  })

  it('counters are independent per tenant', async () => {
    const a = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const b = await asUserB(request(app).post('/api/purchases')).send(basePayload({ supplier_name: 'Beta Supplier' })).expect(201)
    expect(a.body.receipt_number).toBe(1)
    expect(b.body.receipt_number).toBe(1)
  })

  it('allows editing receipt_number to a free value while draft', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const res = await asUserA(request(app).patch(`/api/purchases/${r.body.id}`)).send({ receipt_number: 42 }).expect(200)
    expect(res.body.receipt_number).toBe(42)
  })

  it('rejects a duplicate receipt_number with 409', async () => {
    const r1 = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const r2 = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const res = await asUserA(request(app).patch(`/api/purchases/${r2.body.id}`)).send({ receipt_number: r1.body.receipt_number })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('receipt_number_taken')
  })

  it('rejects a non-positive receipt_number with 400', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const res = await asUserA(request(app).patch(`/api/purchases/${r.body.id}`)).send({ receipt_number: 0 })
    expect(res.status).toBe(400)
  })

  it('rejects editing receipt_number after finalize with 409', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)
    const res = await asUserA(request(app).patch(`/api/purchases/${r.body.id}`)).send({ receipt_number: 99 })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('purchase_finalized')
  })
})

describe('purchases — finalization gate', () => {
  it('PATCH status approved sets finalized_at', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const patched = await approve(r.body.id, asUserA)
    expect(patched.body.status).toBe('approved')
    expect(patched.body.finalized_at).not.toBeNull()
  })

  it('rejects approving an incomplete zero-amount line with structured field errors', async () => {
    await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ default_expense_account_code: null })
      .expect(200)
    const r = await asUserA(request(app).post('/api/purchases'))
      .send(basePayload({
        lines: [{ description: '', tax_rate: 21, amount_incl_cents: 0 }],
      }))
      .expect(201)

    const res = await asUserA(request(app).patch(`/api/purchases/${r.body.id}`))
      .send({ status: 'approved' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('purchase_line_validation')
    expect(res.body.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 0, field: 'description' }),
      expect.objectContaining({ line: 0, field: 'account_code' }),
      expect.objectContaining({ line: 0, field: 'amount_incl_cents' }),
    ]))
  })

  it('content PATCH after finalize returns 409', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)
    const res = await asUserA(request(app).patch(`/api/purchases/${r.body.id}`)).send({ supplier_name: 'Hacked' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('purchase_finalized')
  })

  it('DELETE on non-draft purchase is rejected', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)
    const res = await asUserA(request(app).delete(`/api/purchases/${r.body.id}`))
    expect(res.status).toBe(409)
  })

  it('DELETE on draft purchase succeeds', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await asUserA(request(app).delete(`/api/purchases/${r.body.id}`)).expect(204)
  })
})

describe('purchases — payment', () => {
  it('registers payment on an approved purchase', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)
    const res = await asUserA(request(app).post(`/api/purchases/${r.body.id}/payment`)).send({ paid_on: '2026-06-01' }).expect(200)
    expect(res.body.status).toBe('paid')
    expect(res.body.paid_at).not.toBeNull()
  })

  it('rejects paying a draft purchase with 409', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    const res = await asUserA(request(app).post(`/api/purchases/${r.body.id}/payment`)).send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('not_approved')
  })

  it('cross-tenant payment returns 404', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)
    const res = await asUserB(request(app).post(`/api/purchases/${r.body.id}/payment`)).send({})
    expect(res.status).toBe(404)
  })

  it('rejects direct PATCH to status paid with 409', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)
    const res = await asUserA(request(app).patch(`/api/purchases/${r.body.id}`)).send({ status: 'paid' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('use_payment_endpoint')
  })
})

describe('purchases — totals', () => {
  it('derives net and VAT from an inclusive amount at 21%', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    expect(r.body.total_cents).toBe(125000)
    expect(r.body.subtotal_cents).toBe(103306)
    expect(r.body.tax_cents).toBe(21694)
  })
})

describe('purchases — line account_code', () => {
  it('round-trips a per-line account_code', async () => {
    const created = await asUserA(request(app).post('/api/purchases'))
      .send(basePayload({ lines: [{ description: 'Gas', account_code: '61200', tax_rate: 21, amount_incl_cents: 12100 }] }))
      .expect(201)
    expect(created.body.lines[0].account_code).toBe('61200')
    const got = await asUserA(request(app).get(`/api/purchases/${created.body.id}`)).expect(200)
    expect(got.body.lines[0].account_code).toBe('61200')
  })

  it('rejects a non-expense account_code with 400', async () => {
    const res = await asUserA(request(app).post('/api/purchases'))
      .send(basePayload({ lines: [{ description: 'x', account_code: '11000', tax_rate: 21, amount_incl_cents: 1000 }] }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_account_code')
  })

  it('records who fronted a member-paid bill', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)
    const res = await asUserA(request(app).post(`/api/purchases/${r.body.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: seed.memberA.id, paid_on: '2026-06-01' }).expect(200)
    expect(res.body.payment_method).toBe('member')
    expect(res.body.paid_by_band_member_id).toBe(seed.memberA.id)
  })

  it('records an unlinked band member as the reimbursement payee', async () => {
    const { rows: [member] } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
       VALUES ($1, 'Cash Fronted Friend', 'sub', 10, NULL)
       RETURNING id`,
      [seed.tenantA.id],
    )
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)

    const res = await asUserA(request(app).post(`/api/purchases/${r.body.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: member.id, paid_on: '2026-06-01' }).expect(200)

    expect(res.body.payment_method).toBe('member')
    expect(res.body.paid_by_band_member_id).toBe(member.id)
  })

  it('rejects a cross-tenant band member as reimbursement payee', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)

    const res = await asUserA(request(app).post(`/api/purchases/${r.body.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: seed.memberB.id, paid_on: '2026-06-01' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid paid_by_band_member_id')
  })
})

describe('contacts — duplicate', () => {
  it('returns 409 contact_exists on a duplicate name+category', async () => {
    await asUserA(request(app).post('/api/contacts')).send({ name: 'Studio X', category: 'supplier' }).expect(201)
    const res = await asUserA(request(app).post('/api/contacts')).send({ name: 'Studio X', category: 'supplier' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('contact_exists')
  })
})

describe('purchases period filtering', () => {
  it('lists only purchases in the requested period', async () => {
    await asUserA(request(app).post('/api/purchases')).send(basePayload({
      receipt_date: '2026-03-15',
      supplier_name: 'March Supplier',
    })).expect(201)
    await asUserA(request(app).post('/api/purchases')).send(basePayload({
      receipt_date: '2026-06-15',
      supplier_name: 'June Supplier',
    })).expect(201)
    await asUserA(request(app).post('/api/purchases')).send(basePayload({
      receipt_date: '2025-09-15',
      supplier_name: 'Past Supplier',
    })).expect(201)

    const month = await asUserA(
      request(app).get('/api/purchases?mode=month&year=2026&month=2')
    ).expect(200)
    expect(month.body.map((row) => row.supplier_name)).toEqual(['March Supplier'])

    const year = await asUserA(
      request(app).get('/api/purchases?mode=fiscal_year&year=2026')
    ).expect(200)
    expect(year.body.map((row) => row.supplier_name).sort()).toEqual(['June Supplier', 'March Supplier'])
  })

  it('returns tenant-scoped period availability dates', async () => {
    await asUserA(request(app).post('/api/purchases')).send(basePayload({ receipt_date: '2026-03-15' })).expect(201)
    await asUserB(request(app).post('/api/purchases')).send(basePayload({
      supplier_name: 'Beta Supplier',
      receipt_date: '2026-04-15',
    })).expect(201)

    const res = await asUserA(request(app).get('/api/purchases/periods')).expect(200)
    expect(res.body).toEqual(['2026-03-15'])
  })
})
