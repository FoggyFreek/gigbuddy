import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

// Stub the MinIO client so the PDF render path (putObject/getObject/removeObject)
// is a no-op. Tests assert DB state, not actual storage I/O.
vi.mock('../../../server/utils/storage.js', () => {
  return {
    BUCKET: 'test-bucket',
    storageClient: {
      putObject: vi.fn(async () => ({ etag: 'test' })),
      getObject: vi.fn(async () => {
        throw new Error('no such key')
      }),
      statObject: vi.fn(async () => ({ size: 0, metaData: {} })),
      removeObject: vi.fn(async () => undefined),
    },
  }
})

// Stub sharp/image-reencoding (logo upload) so we don't need a real image.
vi.mock('../../../server/utils/imageProcess.js', () => ({
  validateAndReencodeImage: vi.fn(async (buffer) => ({
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
  })),
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

  // Give Alpha gig a fee + linked venue, and Beta similarly.
  await pool.query(
    `UPDATE gigs SET booking_fee_cents = 50000, venue_id = $1 WHERE id = $2`,
    [seed.venues[0].id, seed.gigA.id],
  )
  await pool.query(
    `UPDATE gigs SET booking_fee_cents = 70000, venue_id = $1 WHERE id = $2`,
    [seed.venues[1].id, seed.gigB.id],
  )
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
    gig_id: seed.gigA.id,
    customer_name: 'Alpha Hall',
    issue_date: '2026-05-01',
    payment_term_days: 14,
    tax_inclusive: false,
    discount_cents: 0,
    lines: [
      { description: 'Optreden', quantity: 1, unit_price_cents: 50000, tax_percentage: 9 },
    ],
    ...overrides,
  }
}

describe('invoices — isolation', () => {
  it('list returns only the active tenant', async () => {
    await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    await asUserB(request(app).post('/api/invoices')).send(basePayload({
      gig_id: seed.gigB.id, customer_name: 'Beta Hall',
    })).expect(201)

    const a = await asUserA(request(app).get('/api/invoices')).expect(200)
    const b = await asUserB(request(app).get('/api/invoices')).expect(200)
    expect(a.body).toHaveLength(1)
    expect(a.body[0].customer_name).toBe('Alpha Hall')
    expect(b.body).toHaveLength(1)
    expect(b.body[0].customer_name).toBe('Beta Hall')
  })

  it('cross-tenant get returns 404', async () => {
    const created = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const foreign = await asUserB(request(app).get(`/api/invoices/${created.body.id}`))
    expect(foreign.status).toBe(404)
    // The row exists and is visible to its owning tenant — the 404 is isolation, not absence.
    const owner = await asUserA(request(app).get(`/api/invoices/${created.body.id}`)).expect(200)
    expect(owner.body.id).toBe(created.body.id)
  })

  it('cross-tenant gig_id rejected with 400', async () => {
    const res = await asUserA(request(app).post('/api/invoices'))
      .send(basePayload({ gig_id: seed.gigB.id }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/gig/i)
  })
})

describe('invoices — number generation', () => {
  it('produces sequential numbers within the same year', async () => {
    const r1 = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const r2 = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const r3 = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    expect(r1.body.invoice_number).toBe('2026-0001')
    expect(r2.body.invoice_number).toBe('2026-0002')
    expect(r3.body.invoice_number).toBe('2026-0003')
  })

  it('parallel creates produce distinct sequential numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        asUserA(request(app).post('/api/invoices')).send(basePayload()),
      ),
    )
    const numbers = results.map((r) => r.body.invoice_number).sort()
    expect(numbers).toEqual([
      '2026-0001', '2026-0002', '2026-0003', '2026-0004', '2026-0005',
    ])
  })

  it('counters are independent per tenant', async () => {
    const a = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const b = await asUserB(request(app).post('/api/invoices')).send(basePayload({
      gig_id: seed.gigB.id, customer_name: 'Beta Hall',
    })).expect(201)
    expect(a.body.invoice_number).toBe('2026-0001')
    expect(b.body.invoice_number).toBe('2026-0001')
  })
})

describe('invoices — totals are stored authoritatively', () => {
  it('exclusive VAT', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload({
      tax_inclusive: false,
      lines: [{ description: 'x', quantity: 2, unit_price_cents: 10000, tax_percentage: 21 }],
    })).expect(201)
    expect(r.body.subtotal_cents).toBe(20000)
    expect(r.body.tax_cents).toBe(4200)
    expect(r.body.total_cents).toBe(24200)
  })
})

describe('invoices — finalization gate', () => {
  it('PATCH with status sent finalizes the invoice', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const patched = await asUserA(request(app).patch(`/api/invoices/${r.body.id}`))
      .send({ status: 'sent' }).expect(200)
    expect(patched.body.status).toBe('sent')
    expect(patched.body.finalized_at).not.toBeNull()
  })

  it('PATCH on finalized invoice with content fields returns 409', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    await asUserA(request(app).patch(`/api/invoices/${r.body.id}`)).send({ status: 'sent' }).expect(200)
    const res = await asUserA(request(app).patch(`/api/invoices/${r.body.id}`))
      .send({ customer_name: 'Hacked' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('invoice_finalized')
  })

  it('PATCH on finalized invoice with memo and status succeeds', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    await asUserA(request(app).patch(`/api/invoices/${r.body.id}`)).send({ status: 'sent' }).expect(200)
    const res = await asUserA(request(app).patch(`/api/invoices/${r.body.id}`))
      .send({ status: 'paid', memo: 'Thanks!' }).expect(200)
    expect(res.body.status).toBe('paid')
    expect(res.body.memo).toBe('Thanks!')
  })

  it('DELETE on non-draft invoice is rejected', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    await asUserA(request(app).patch(`/api/invoices/${r.body.id}`)).send({ status: 'sent' }).expect(200)
    const res = await asUserA(request(app).delete(`/api/invoices/${r.body.id}`))
    expect(res.status).toBe(409)
    const { rows } = await pool.query('SELECT id FROM invoices WHERE id = $1', [r.body.id])
    expect(rows).toHaveLength(1)
  })

  it('DELETE on draft removes the row', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const del = await asUserA(request(app).delete(`/api/invoices/${r.body.id}`))
    expect(del.status).toBe(204)
    const { rows } = await pool.query('SELECT id FROM invoices WHERE id = $1', [r.body.id])
    expect(rows).toHaveLength(0)
  })
})

describe('invoices — draft-from-gig', () => {
  it('returns a pre-filled draft from a gig with its linked venue', async () => {
    const res = await asUserA(request(app).get(`/api/invoices/draft-from-gig/${seed.gigA.id}`)).expect(200)
    expect(res.body.draft.gig_id).toBe(seed.gigA.id)
    expect(res.body.draft.customer_name).toBe(seed.venues[0].name)
    expect(res.body.draft.lines).toHaveLength(1)
    expect(res.body.draft.lines[0].unit_price_cents).toBe(50000)
  })

  it('returns empty billing_targets when only venue is linked', async () => {
    const res = await asUserA(request(app).get(`/api/invoices/draft-from-gig/${seed.gigA.id}`)).expect(200)
    expect(res.body.billing_targets).toEqual([])
  })

  it('returns empty billing_targets when gig has no venue or festival', async () => {
    const { rows } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, '2026-11-01', 'No Venue Gig') RETURNING id`,
      [seed.tenantA.id],
    )
    const res = await asUserA(
      request(app).get(`/api/invoices/draft-from-gig/${rows[0].id}`)
    ).expect(200)
    expect(res.body.billing_targets).toEqual([])
    expect(res.body.draft.customer_name).toBe('')
  })

  it('returns two billing_targets when gig has both festival and venue', async () => {
    const { rows: fv } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name, city)
       VALUES ($1, 'festival', 'Texel Blues Festival', 'Den Hoorn') RETURNING id`,
      [seed.tenantA.id],
    )
    const festivalId = fv[0].id
    await pool.query(
      'UPDATE gigs SET festival_id = $1 WHERE id = $2',
      [festivalId, seed.gigA.id],
    )
    const res = await asUserA(
      request(app).get(`/api/invoices/draft-from-gig/${seed.gigA.id}`)
    ).expect(200)
    expect(res.body.billing_targets).toHaveLength(2)
    const types = res.body.billing_targets.map((t) => t.type)
    expect(types).toContain('festival')
    expect(types).toContain('venue')
    // Default customer should be from festival (first target)
    expect(res.body.draft.customer_name).toContain('Texel Blues')
  })

  it('cross-tenant draft returns 404', async () => {
    const res = await asUserA(request(app).get(`/api/invoices/draft-from-gig/${seed.gigB.id}`))
    expect(res.status).toBe(404)
  })
})

describe('invoices — discount', () => {
  it('percentage discount stores correct totals and round-trips discount_type + discount_pct', async () => {
    const r = await asUserA(request(app).post('/api/invoices'))
      .send(basePayload({
        discount_type: 'pct',
        discount_pct: 10,
        discount_cents: 0,
      })).expect(201)
    // subtotal=50000, pct=10 → discount=5000
    // discounted net=45000; VAT = round(45000 * 9 / 100) = 4050; total = 49050
    expect(r.body.discount_type).toBe('pct')
    expect(Number(r.body.discount_pct)).toBe(10)
    expect(r.body.discount_cents).toBe(5000)
    expect(r.body.subtotal_cents).toBe(50000)
    expect(r.body.tax_cents).toBe(4050)
    expect(r.body.total_cents).toBe(49050)
  })

  it('absolute discount (eur type) stores correct totals', async () => {
    const r = await asUserA(request(app).post('/api/invoices'))
      .send(basePayload({
        discount_type: 'eur',
        discount_cents: 10000,
      })).expect(201)
    // subtotal=50000, discount=10000
    // discounted net=40000; VAT = round(40000 * 9 / 100) = 3600; total = 43600
    expect(r.body.discount_type).toBe('eur')
    expect(r.body.discount_cents).toBe(10000)
    expect(r.body.subtotal_cents).toBe(50000)
    expect(r.body.tax_cents).toBe(3600)
    expect(r.body.total_cents).toBe(43600)
  })

  it('PATCH can apply a percentage discount and recomputes totals', async () => {
    const created = await asUserA(request(app).post('/api/invoices'))
      .send(basePayload()).expect(201)

    const patched = await asUserA(request(app).patch(`/api/invoices/${created.body.id}`))
      .send({ discount_type: 'pct', discount_pct: 20 }).expect(200)
    // subtotal=50000, pct=20 → discount=10000
    // discounted net=40000; VAT = round(40000 * 9 / 100) = 3600; total = 43600
    expect(patched.body.discount_type).toBe('pct')
    expect(Number(patched.body.discount_pct)).toBe(20)
    expect(patched.body.discount_cents).toBe(10000)
    expect(patched.body.tax_cents).toBe(3600)
    expect(patched.body.total_cents).toBe(43600)
  })

  it('PATCH can switch from pct to eur discount and recomputes totals', async () => {
    const created = await asUserA(request(app).post('/api/invoices'))
      .send(basePayload({ discount_type: 'pct', discount_pct: 10, discount_cents: 0 })).expect(201)
    expect(created.body.discount_cents).toBe(5000)

    const patched = await asUserA(request(app).patch(`/api/invoices/${created.body.id}`))
      .send({ discount_type: 'eur', discount_cents: 15000 }).expect(200)
    // subtotal=50000, eur=15000
    // discounted net=35000; VAT = round(35000 * 9 / 100) = 3150; total = 38150
    expect(patched.body.discount_type).toBe('eur')
    expect(patched.body.discount_cents).toBe(15000)
    expect(patched.body.tax_cents).toBe(3150)
    expect(patched.body.total_cents).toBe(38150)
  })

  it('PATCH with only discount_cents recomputes totals on a eur-discount invoice', async () => {
    const created = await asUserA(request(app).post('/api/invoices'))
      .send(basePayload({ discount_type: 'eur', discount_cents: 10000 })).expect(201)
    expect(created.body.total_cents).toBe(43600)

    const patched = await asUserA(request(app).patch(`/api/invoices/${created.body.id}`))
      .send({ discount_cents: 15000 })
    expect(patched.status).toBe(200)
    // subtotal=50000, eur=15000 → net 35000; VAT round(35000*9/100)=3150; total 38150
    expect(patched.body.discount_cents).toBe(15000)
    expect(patched.body.tax_cents).toBe(3150)
    expect(patched.body.total_cents).toBe(38150)
  })

  it('PATCH with only discount_cents is blocked on a finalized invoice (409)', async () => {
    const created = await asUserA(request(app).post('/api/invoices'))
      .send(basePayload({ discount_type: 'eur', discount_cents: 10000 })).expect(201)
    await asUserA(request(app).patch(`/api/invoices/${created.body.id}`)).send({ status: 'sent' }).expect(200)

    const res = await asUserA(request(app).patch(`/api/invoices/${created.body.id}`))
      .send({ discount_cents: 5000 })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('invoice_finalized')
  })
})

describe('invoices — PATCH gig_id + recompute', () => {
  it('normalizes a numeric-string gig_id and persists the integer', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const res = await asUserA(request(app).patch(`/api/invoices/${r.body.id}`))
      .send({ gig_id: String(seed.gigA.id) })
    expect(res.status).toBe(200)
    expect(res.body.gig_id).toBe(seed.gigA.id)
    const { rows } = await pool.query('SELECT gig_id FROM invoices WHERE id = $1', [r.body.id])
    expect(rows[0].gig_id).toBe(seed.gigA.id)
  })

  it('rejects a cross-tenant gig_id and leaves the stored gig_id unchanged', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const res = await asUserA(request(app).patch(`/api/invoices/${r.body.id}`))
      .send({ gig_id: seed.gigB.id })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/gig/i)
    const { rows } = await pool.query('SELECT gig_id FROM invoices WHERE id = $1', [r.body.id])
    expect(rows[0].gig_id).toBe(seed.gigA.id)
  })

  it('rejects an invalid status', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const res = await asUserA(request(app).patch(`/api/invoices/${r.body.id}`)).send({ status: 'bogus' })
    expect(res.status).toBe(400)
  })

  it('recomputes stored totals when lines change', async () => {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload({
      lines: [{ description: 'x', quantity: 1, unit_price_cents: 10000, tax_percentage: 21 }],
    })).expect(201)
    expect(r.body.total_cents).toBe(12100)
    const res = await asUserA(request(app).patch(`/api/invoices/${r.body.id}`)).send({
      lines: [{ description: 'x', quantity: 2, unit_price_cents: 10000, tax_percentage: 21 }],
    })
    expect(res.status).toBe(200)
    expect(res.body.subtotal_cents).toBe(20000)
    expect(res.body.tax_cents).toBe(4200)
    expect(res.body.total_cents).toBe(24200)
  })
})

describe('invoices — .eml header sanitization', () => {
  async function emlFor(overrides) {
    const r = await asUserA(request(app).post('/api/invoices')).send(basePayload(overrides)).expect(201)
    const res = await asUserA(request(app).post(`/api/invoices/${r.body.id}/eml`)).send({})
    expect(res.status).toBe(200)
    return res.text
  }

  it('rejects CRLF header injection via customer_email (no To, no injected header)', async () => {
    const text = await emlFor({
      customer_name: 'Victim',
      customer_email: 'evil@example.com\r\nBcc: attacker@example.com',
    })
    expect(text).not.toMatch(/[\r\n]Bcc:/i)
    expect(text).not.toMatch(/[\r\n]To:/)
  })

  it('strips CR/LF from customer_name so it cannot inject headers', async () => {
    const text = await emlFor({
      customer_name: 'Evil\r\nBcc: attacker@example.com',
      customer_email: 'real@example.com',
    })
    expect(text).not.toMatch(/[\r\n]Bcc:/i)
    expect(text).toMatch(/[\r\n]To: .*<real@example\.com>/)
  })

  it('formats a plain display name + email', async () => {
    const text = await emlFor({ customer_name: 'John Doe', customer_email: 'john@example.com' })
    expect(text).toContain('To: John Doe <john@example.com>')
  })

  it('quotes a display name containing RFC 5322 specials', async () => {
    const text = await emlFor({ customer_name: 'Acme, B.V.', customer_email: 'billing@acme.example' })
    expect(text).toContain('To: "Acme, B.V." <billing@acme.example>')
  })

  it('MIME-encodes a non-ASCII display name', async () => {
    const text = await emlFor({ customer_name: 'José Café', customer_email: 'jose@example.com' })
    const encoded = `=?UTF-8?B?${Buffer.from('José Café', 'utf8').toString('base64')}?= <jose@example.com>`
    expect(text).toContain(`To: ${encoded}`)
  })

  it('omits the To header entirely for an invalid email', async () => {
    const text = await emlFor({ customer_name: 'No Email', customer_email: 'not-an-email' })
    expect(text).not.toMatch(/[\r\n]To:/)
  })
})

describe('invoices — render retry', () => {
  it('row persists with pdf_path NULL when render fails, retry populates it', async () => {
    // First create with broken render (mock putObject to reject once).
    const storage = await import('../../../server/utils/storage.js')
    storage.storageClient.putObject.mockRejectedValueOnce(new Error('boom'))

    const created = await asUserA(request(app).post('/api/invoices')).send(basePayload()).expect(201)
    const { rows: r1 } = await pool.query('SELECT pdf_path FROM invoices WHERE id = $1', [created.body.id])
    expect(r1[0].pdf_path).toBeNull()

    await asUserA(request(app).post(`/api/invoices/${created.body.id}/render`)).expect(200)
    const { rows: r2 } = await pool.query('SELECT pdf_path FROM invoices WHERE id = $1', [created.body.id])
    expect(r2[0].pdf_path).toMatch(/^tenants\//)
  })
})
