import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'
import { Readable } from 'node:stream'

// In-memory stand-in for the MinIO/RustFS client: CI has no object storage,
// and the attachment tests stream back what they upload, so the mock must
// retain the bytes and content type per key (unlike the throw-away stub in
// invoices.test.js).
const objectStore = new Map()
vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async (bucket, key, buffer, size, meta) => {
      objectStore.set(key, { buffer, contentType: meta?.['Content-Type'] })
      return { etag: 'test' }
    }),
    statObject: vi.fn(async (bucket, key) => {
      const obj = objectStore.get(key)
      if (!obj) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' })
      return { size: obj.buffer.length, metaData: { 'content-type': obj.contentType } }
    }),
    getObject: vi.fn(async (bucket, key) => {
      const obj = objectStore.get(key)
      if (!obj) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' })
      return Readable.from(obj.buffer)
    }),
    removeObject: vi.fn(async (bucket, key) => {
      objectStore.delete(key)
    }),
  },
}))

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

  it('rejects re-registering payment on an already-paid purchase, leaving it unchanged', async () => {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    await approve(r.body.id, asUserA)
    await asUserA(request(app).post(`/api/purchases/${r.body.id}/payment`)).send({ paid_on: '2026-06-01' }).expect(200)

    // Re-paying as a band member must not flip a bank-paid purchase (which would
    // fabricate member debt no liability journal ever created).
    const res = await asUserA(request(app).post(`/api/purchases/${r.body.id}/payment`))
      .send({ method: 'member', paid_by_band_member_id: seed.memberA.id, paid_on: '2026-06-02' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('already_paid')

    const after = await asUserA(request(app).get(`/api/purchases/${r.body.id}`)).expect(200)
    expect(after.body.payment_method).toBe('bank')
    expect(after.body.paid_by_band_member_id).toBeNull()
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

describe('purchases — capitalizing fixed assets', () => {
  it('accepts a capitalizable asset account on a line and round-trips it', async () => {
    const created = await asUserA(request(app).post('/api/purchases'))
      .send(basePayload({ lines: [{ description: 'PA system', account_code: '13000', tax_rate: 21, amount_incl_cents: 121000 }] }))
      .expect(201)
    expect(created.body.lines[0].account_code).toBe('13000')
    const got = await asUserA(request(app).get(`/api/purchases/${created.body.id}`)).expect(200)
    expect(got.body.lines[0].account_code).toBe('13000')
  })

  it('posts the net cost as a debit to the asset account on approval', async () => {
    const created = await asUserA(request(app).post('/api/purchases'))
      .send(basePayload({ lines: [{ description: 'PA system', account_code: '13000', tax_rate: 21, amount_incl_cents: 121000 }] }))
      .expect(201)
    await approve(created.body.id, asUserA)

    const { rows } = await pool.query(
      `SELECT le.account_code, le.debit_cents, le.credit_cents
         FROM ledger_entries le
         JOIN ledger_transactions lt ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
        WHERE le.tenant_id = $1 AND lt.source_type = 'purchase'
          AND lt.source_id = $2 AND lt.source_event = 'accrued'`,
      [seed.tenantA.id, created.body.id],
    )
    const byCode = Object.fromEntries(rows.map((r) => [r.account_code, r]))
    // 121000 incl @21% → 100000 net to the gear asset, 21000 input VAT, 121000 payable.
    expect(byCode['13000'].debit_cents).toBe(100000)
    expect(byCode['13000'].credit_cents).toBe(0)
    expect(byCode['15000'].debit_cents).toBe(21000)
    expect(byCode['21100'].credit_cents).toBe(121000)
  })

  it('rejects a non-capitalizable asset account with 400', async () => {
    // 12200 (merch inventory) is an asset but not flagged capitalizable.
    const res = await asUserA(request(app).post('/api/purchases'))
      .send(basePayload({ lines: [{ description: 'x', account_code: '12200', tax_rate: 21, amount_incl_cents: 1000 }] }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_account_code')
  })
})

describe('purchases — attachments', () => {
  const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n')
  let pngBuffer

  beforeAll(async () => {
    const sharp = (await import('sharp')).default
    pngBuffer = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 30, b: 30 } },
    }).png().toBuffer()
  })

  async function createPurchaseA() {
    const r = await asUserA(request(app).post('/api/purchases')).send(basePayload()).expect(201)
    return r.body
  }

  function uploadA(id, buffer, filename, contentType) {
    return asUserA(request(app).post(`/api/purchases/${id}/attachments`))
      .attach('file', buffer, { filename, contentType })
  }

  it('uploads a PDF receipt and lists it on the purchase', async () => {
    const p = await createPurchaseA()
    const res = await uploadA(p.id, pdfBuffer, 'receipt.pdf', 'application/pdf').expect(201)
    expect(res.body.original_filename).toBe('receipt.pdf')
    expect(res.body.content_type).toBe('application/pdf')
    expect(res.body.object_key).toMatch(new RegExp(`^tenants/${seed.tenantA.id}/purchase_attachments/`))

    const detail = await asUserA(request(app).get(`/api/purchases/${p.id}`)).expect(200)
    expect(detail.body.attachments).toHaveLength(1)
    expect(detail.body.attachments[0].id).toBe(res.body.id)
  })

  it('uploads a PNG receipt (re-encoded image path)', async () => {
    const p = await createPurchaseA()
    const res = await uploadA(p.id, pngBuffer, 'receipt.png', 'image/png').expect(201)
    expect(res.body.content_type).toBe('image/png')
    expect(res.body.object_key).toMatch(/\.png$/)
  })

  it('rejects content that does not match the declared image type', async () => {
    const p = await createPurchaseA()
    const res = await uploadA(p.id, pdfBuffer, 'receipt.png', 'image/png')
    expect(res.status).toBe(400)
  })

  it('rejects content that does not match the declared pdf type', async () => {
    const p = await createPurchaseA()
    const res = await uploadA(p.id, pngBuffer, 'receipt.pdf', 'application/pdf')
    expect(res.status).toBe(400)
  })

  it('rejects a disallowed file type', async () => {
    const p = await createPurchaseA()
    const res = await uploadA(p.id, Buffer.from('hello'), 'notes.txt', 'text/plain')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not allowed/i)
  })

  it('allows uploads on approved and paid purchases', async () => {
    const p = await createPurchaseA()
    await approve(p.id, asUserA)
    await uploadA(p.id, pdfBuffer, 'approved.pdf', 'application/pdf').expect(201)
    await asUserA(request(app).post(`/api/purchases/${p.id}/payment`))
      .send({ method: 'bank', paid_on: '2026-06-01' }).expect(200)
    await uploadA(p.id, pdfBuffer, 'paid.pdf', 'application/pdf').expect(201)
  })

  it("cross-tenant upload to another tenant's purchase returns 404", async () => {
    const p = await createPurchaseA()
    const res = await asUserB(request(app).post(`/api/purchases/${p.id}/attachments`))
      .attach('file', pdfBuffer, { filename: 'receipt.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(404)
  })

  it('owner can stream the attachment via /api/files, cross-tenant gets 404', async () => {
    const p = await createPurchaseA()
    const up = await uploadA(p.id, pdfBuffer, 'receipt.pdf', 'application/pdf').expect(201)
    const ok = await asUserA(request(app).get(`/api/files/${up.body.object_key}`)).expect(200)
    expect(ok.headers['content-type']).toContain('application/pdf')
    await asUserB(request(app).get(`/api/files/${up.body.object_key}`)).expect(404)
  })

  it('inline preview relaxes framing to same-origin; plain download stays locked down', async () => {
    const p = await createPurchaseA()
    const up = await uploadA(p.id, pdfBuffer, 'receipt.pdf', 'application/pdf').expect(201)

    const inline = await asUserA(request(app).get(`/api/files/${up.body.object_key}?inline=1`)).expect(200)
    expect(inline.headers['content-disposition']).toMatch(/^inline/)
    expect(inline.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(inline.headers['content-security-policy']).toContain("frame-ancestors 'self'")

    const download = await asUserA(request(app).get(`/api/files/${up.body.object_key}`)).expect(200)
    expect(download.headers['content-disposition']).toMatch(/^attachment/)
  })

  it('delete removes the attachment, cross-tenant delete returns 404', async () => {
    const p = await createPurchaseA()
    const up = await uploadA(p.id, pdfBuffer, 'receipt.pdf', 'application/pdf').expect(201)

    await asUserB(request(app).delete(`/api/purchases/${p.id}/attachments/${up.body.id}`)).expect(404)
    await asUserA(request(app).delete(`/api/purchases/${p.id}/attachments/${up.body.id}`)).expect(204)

    const detail = await asUserA(request(app).get(`/api/purchases/${p.id}`)).expect(200)
    expect(detail.body.attachments).toHaveLength(0)
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
