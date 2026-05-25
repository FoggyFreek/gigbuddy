import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

// Stub MinIO so PDF render path is a no-op.
vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async () => ({ etag: 'test' })),
    getObject: vi.fn(async () => { throw new Error('no such key') }),
    statObject: vi.fn(async () => ({ size: 0, metaData: {} })),
    removeObject: vi.fn(async () => undefined),
  },
}))

vi.mock('../../../server/utils/imageProcess.js', () => ({
  validateAndReencodeImage: vi.fn(async (buffer) => ({
    buffer, size: buffer.length, mimetype: 'image/png',
  })),
}))

// Mollie client mock — all test cases customise these fns.
const mockPaymentLinksCreate = vi.fn()
const mockPaymentLinksGet = vi.fn()

vi.mock('../../../server/utils/mollieClient.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createTenantMollieClient: vi.fn(() => ({
      paymentLinks: {
        create: mockPaymentLinksCreate,
        get: mockPaymentLinksGet,
      },
    })),
  }
})

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

  // Give tenant A a Mollie key and financial data.
  await pool.query(
    `UPDATE tenants SET mollie_api_key = 'test_mollie_key_alpha', band_name = 'Alpha Band'
      WHERE id = $1`,
    [seed.tenantA.id],
  )

  // Give gig A a booking fee.
  await pool.query(
    `UPDATE gigs SET booking_fee_cents = 50000, venue_id = $1 WHERE id = $2`,
    [seed.venues[0].id, seed.gigA.id],
  )

  vi.clearAllMocks()
  delete process.env.MOLLIE_DISABLE_WEBHOOK

  // Default Mollie mock: successful payment link creation.
  mockPaymentLinksCreate.mockResolvedValue({
    id: 'pl_test123',
    _links: { paymentLink: { href: 'https://paymentlink.mollie.com/payment/test123', type: 'text/html' } },
  })

  // Default sync mock: open status, no payment yet.
  mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({ status: 'open' }))
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

async function createInvoiceA(overrides = {}) {
  const res = await asUserA(request(app).post('/api/invoices')).send({
    customer_name: 'Alpha Hall',
    issue_date: '2026-05-01',
    payment_term_days: 14,
    lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 50000, tax_percentage: 0 }],
    ...overrides,
  })
  expect(res.status).toBe(201)
  return res.body
}

function mockPaymentLink({ id = 'pl_test123', status = 'open', payments = [] } = {}) {
  return {
    id,
    status,
    getPayments: () => mockPaymentIterator(payments),
  }
}

function mockPaymentIterator(payments) {
  return {
    take: (limit) => mockPaymentIterator(payments.slice(0, limit)),
    async *[Symbol.asyncIterator]() {
      yield* payments
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mollieClient utilities
// ─────────────────────────────────────────────────────────────────────────────

describe('mollieClient utilities', () => {
  let utils
  beforeAll(async () => {
    utils = await import('../../../server/utils/mollieClient.js')
  })

  it('formatMollieAmountFromCents converts 2495 → "24.95"', () => {
    expect(utils.formatMollieAmountFromCents(2495)).toBe('24.95')
  })
  it('formatMollieAmountFromCents converts 100 → "1.00"', () => {
    expect(utils.formatMollieAmountFromCents(100)).toBe('1.00')
  })
  it('formatMollieAmountFromCents converts 0 → "0.00"', () => {
    expect(utils.formatMollieAmountFromCents(0)).toBe('0.00')
  })
  it('formatMollieAmountFromCents converts 50000 → "500.00"', () => {
    expect(utils.formatMollieAmountFromCents(50000)).toBe('500.00')
  })
  it('formatMollieAmountFromCents throws for non-integer', () => {
    expect(() => utils.formatMollieAmountFromCents(1.5)).toThrow()
  })
  it('formatMollieAmountFromCents throws for negative', () => {
    expect(() => utils.formatMollieAmountFromCents(-1)).toThrow()
  })

  it('assertMollieConfigured throws with code mollie_key_missing when key absent', () => {
    expect(() => utils.assertMollieConfigured({ mollie_api_key: null })).toThrow()
    expect(() => utils.assertMollieConfigured({})).toThrow()
  })

  it('assertMollieConfigured does not throw when key is present', () => {
    expect(() => utils.assertMollieConfigured({ mollie_api_key: 'test_abc' })).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/payment-link
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/invoices/:id/payment-link', () => {
  it('creates a payment link and stores it on the invoice', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(201)
    // Response is the full invoice row (matches GET /:id) so the frontend can
    // observe the finalize transition without a refetch.
    expect(res.body.mollie_payment_link_id).toBe('pl_test123')
    expect(res.body.mollie_payment_link_url).toBe('https://paymentlink.mollie.com/payment/test123')
    expect(res.body.mollie_payment_status).toBe('open')
    expect(res.body.status).toBe('sent')
    expect(res.body.finalized_at).not.toBeNull()
    expect(Array.isArray(res.body.lines)).toBe(true)

    // Verify DB was updated.
    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].mollie_payment_link_id).toBe('pl_test123')
    expect(rows[0].mollie_payment_link_url).toBe('https://paymentlink.mollie.com/payment/test123')
    expect(rows[0].mollie_payment_status).toBe('open')
  })

  it('sends correct amount, description, redirectUrl, webhookUrl, reusable to Mollie', async () => {
    process.env.APP_URL = 'https://app.example.com'
    process.env.MOLLIE_WEBHOOK_BASE_URL = 'https://api.example.com'
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: { currency: 'EUR', value: '500.00' },
      description: expect.stringContaining(inv.invoice_number),
      redirectUrl: `https://app.example.com/payment/thanks?invoice=${inv.id}&band=Alpha+Band`,
      webhookUrl: `https://api.example.com/api/public/mollie/payment-links/webhook?invoice=${inv.id}`,
      reusable: false,
    }))
    delete process.env.APP_URL
    delete process.env.MOLLIE_WEBHOOK_BASE_URL
  })

  it('omits webhookUrl when MOLLIE_DISABLE_WEBHOOK=true', async () => {
    process.env.APP_URL = 'https://app.example.com'
    process.env.MOLLIE_WEBHOOK_BASE_URL = 'https://api.example.com'
    process.env.MOLLIE_DISABLE_WEBHOOK = 'true'
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(expect.not.objectContaining({
      webhookUrl: expect.any(String),
    }))
    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: { currency: 'EUR', value: '500.00' },
      redirectUrl: `https://app.example.com/payment/thanks?invoice=${inv.id}&band=Alpha+Band`,
      reusable: false,
    }))
    delete process.env.APP_URL
    delete process.env.MOLLIE_WEBHOOK_BASE_URL
    delete process.env.MOLLIE_DISABLE_WEBHOOK
  })

  it('returns existing link instead of creating a duplicate', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(mockPaymentLinksCreate).toHaveBeenCalledTimes(1)
  })

  it('returns the stored link with 200 (and no leaked Mollie key) when already linked', async () => {
    const inv = await createInvoiceA()
    const first = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(first.status).toBe(201)

    const second = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(second.status).toBe(200)
    expect(second.body.mollie_payment_link_id).toBe('pl_test123')
    expect(Array.isArray(second.body.lines)).toBe(true)
    expect(second.body.tenant).not.toHaveProperty('mollie_api_key')
    expect(mockPaymentLinksCreate).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for zero-total invoice', async () => {
    const inv = await createInvoiceA({
      lines: [{ description: 'Free', quantity: 1, unit_price_cents: 0, tax_percentage: 0 }],
    })
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('zero_amount')
  })

  it('returns 400 for void invoice', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).patch(`/api/invoices/${inv.id}`)).send({ status: 'void' })
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('void_invoice')
  })

  it('returns 400 when tenant has no Mollie key', async () => {
    await pool.query('UPDATE tenants SET mollie_api_key = NULL WHERE id = $1', [seed.tenantA.id])
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/mollie/i)
  })

  it('returns 404 for unknown invoice', async () => {
    const res = await asUserA(request(app).post('/api/invoices/999999/payment-link')).send({})
    expect(res.status).toBe(404)
  })

  it('cross-tenant: tenant B cannot create payment link on tenant A invoice', async () => {
    const inv = await createInvoiceA()
    const res = await asUserB(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(404)
  })

  it('requires authentication', async () => {
    const inv = await createInvoiceA()
    const res = await request(app).post(`/api/invoices/${inv.id}/payment-link`).send({})
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 1: Invoice finalization on payment-link creation
// ─────────────────────────────────────────────────────────────────────────────

describe('Invoice finalization on payment-link creation (issue 1)', () => {
  it('creates payment link for a draft invoice and sets status=sent + finalized_at', async () => {
    const inv = await createInvoiceA()
    expect(inv.status).toBe('draft')
    expect(inv.finalized_at).toBeNull()

    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(201)

    const { rows } = await pool.query('SELECT status, finalized_at FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('sent')
    expect(rows[0].finalized_at).not.toBeNull()
  })

  it('does not regress status when invoice is already finalized (status stays "sent")', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).patch(`/api/invoices/${inv.id}`)).send({ status: 'sent' })

    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(201)

    const { rows } = await pool.query('SELECT status FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('sent')
  })

  it('content edits to line items are blocked after payment-link creation (409)', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    const patchRes = await asUserA(request(app).patch(`/api/invoices/${inv.id}`)).send({
      lines: [{ description: 'Changed', quantity: 1, unit_price_cents: 75000, tax_percentage: 0 }],
    })
    expect(patchRes.status).toBe(409)
    expect(patchRes.body.code).toBe('invoice_finalized')
  })

  it('customer_name edit is blocked after payment-link creation (finalized_at gate)', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    const patchRes = await asUserA(request(app).patch(`/api/invoices/${inv.id}`)).send({
      customer_name: 'Different Name',
    })
    expect(patchRes.status).toBe(409)
  })

  it('Mollie amount matches invoice total_cents at time of link creation', async () => {
    const inv = await createInvoiceA({
      lines: [{ description: 'Gig fee', quantity: 2, unit_price_cents: 25000, tax_percentage: 0 }],
    })
    // total_cents should be 50000 (€500.00)
    expect(inv.total_cents).toBe(50000)

    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: { currency: 'EUR', value: '500.00' } }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/payment-link/sync
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/invoices/:id/payment-link/sync', () => {
  it('returns 400 when invoice has no payment link', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link/sync`)).send()
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('no_payment_link')
  })

  it('updates invoice to paid when Mollie reports paid', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{
        id: 'tr_test456',
        status: 'paid',
        paidAt: '2026-05-15T10:00:00+00:00',
      }],
    }))

    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link/sync`)).send()
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('paid')
    expect(res.body.invoiceStatus).toBe('paid')

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('paid')
    expect(rows[0].mollie_payment_id).toBe('tr_test456')
    expect(rows[0].mollie_paid_at).not.toBeNull()
  })

  it('does not mark paid on non-paid Mollie status', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'open',
      payments: [{
        id: 'tr_test456', status: 'open',
      }],
    }))

    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link/sync`)).send()
    expect(res.status).toBe(200)
    // Invoice is finalized to 'sent' when the payment link is created; sync leaves it 'sent'
    expect(res.body.invoiceStatus).toBe('sent')

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('sent')
  })

  it('returns paymentId (the field PaymentLinkPanel maps into mollie_payment_id)', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{ id: 'tr_paid789', status: 'paid', paidAt: '2026-05-15T10:00:00+00:00' }],
    }))

    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link/sync`)).send()
    expect(res.status).toBe(200)
    expect(res.body.paymentId).toBe('tr_paid789')
  })

  it('is idempotent for paid status', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{
        id: 'tr_test456', status: 'paid', paidAt: '2026-05-15T10:00:00+00:00',
      }],
    }))

    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link/sync`)).send()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link/sync`)).send()
    expect(res.status).toBe(200)
    expect(res.body.invoiceStatus).toBe('paid')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/mollie/payment-links/webhook
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/public/mollie/payment-links/webhook', () => {
  it('is reachable without authentication', async () => {
    const res = await request(app)
      .post('/api/public/mollie/payment-links/webhook')
      .send('id=tr_test')
      .set('Content-Type', 'application/x-www-form-urlencoded')
    expect(res.status).toBe(200)
  })

  it('marks invoice paid on paid webhook', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{
        id: 'tr_webhook456', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00',
      }],
    }))

    const res = await request(app)
      .post(`/api/public/mollie/payment-links/webhook?invoice=${inv.id}`)
      .send('id=tr_webhook456')
      .set('Content-Type', 'application/x-www-form-urlencoded')
    expect(res.status).toBe(200)

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('paid')
    expect(rows[0].mollie_payment_id).toBe('tr_webhook456')
  })

  it('does not mark paid for open payment status', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'open',
      payments: [{ id: 'tr_open', status: 'open' }],
    }))

    await request(app)
      .post(`/api/public/mollie/payment-links/webhook?invoice=${inv.id}`)
      .send('id=tr_open')
      .set('Content-Type', 'application/x-www-form-urlencoded')

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    // Finalized to 'sent' on link creation; stays 'sent' (not promoted to 'paid') for open payment
    expect(rows[0].status).toBe('sent')
  })

  it('returns 200 for unknown invoice id (no data leakage)', async () => {
    const res = await request(app)
      .post('/api/public/mollie/payment-links/webhook?invoice=999999')
      .send('id=tr_unknown')
      .set('Content-Type', 'application/x-www-form-urlencoded')
    expect(res.status).toBe(200)
  })

  it('returns 200 when invoice query param is missing', async () => {
    const res = await request(app)
      .post('/api/public/mollie/payment-links/webhook')
      .send('id=tr_test')
      .set('Content-Type', 'application/x-www-form-urlencoded')
    expect(res.status).toBe(200)
  })

  it('is idempotent for duplicate paid webhook', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{
        id: 'tr_dup', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00',
      }],
    }))

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/public/mollie/payment-links/webhook?invoice=${inv.id}`)
        .send('id=tr_dup')
        .set('Content-Type', 'application/x-www-form-urlencoded')
    }

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('paid')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PBI 9 — Profile GET never exposes the Mollie API key
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/profile — Mollie key hardening', () => {
  it('does not include mollie_api_key in profile response', async () => {
    const res = await asUserA(request(app).get('/api/profile'))
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('mollie_api_key')
  })

  it('does not include mollie_api_key after PATCH', async () => {
    const res = await asUserA(request(app).patch('/api/profile')).send({ band_name: 'New Name' })
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('mollie_api_key')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/mollie-key — masked key status
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/profile/mollie-key', () => {
  it('reports isSet:true with a masked preview when a key is stored', async () => {
    const res = await asUserA(request(app).get('/api/profile/mollie-key'))
    expect(res.status).toBe(200)
    expect(res.body.isSet).toBe(true)
    expect(res.body.preview).toMatch(/^test_/)
    expect(res.body.preview).not.toBe('test_mollie_key_alpha')
  })

  it('reports isSet:false when no key is stored', async () => {
    await pool.query('UPDATE tenants SET mollie_api_key = NULL WHERE id = $1', [seed.tenantA.id])
    const res = await asUserA(request(app).get('/api/profile/mollie-key'))
    expect(res.status).toBe(200)
    expect(res.body.isSet).toBe(false)
    expect(res.body.preview).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// /payment/thanks — public route guard (frontend route, not API)
// ─────────────────────────────────────────────────────────────────────────────

describe('public webhook endpoint authentication', () => {
  it('webhook does not require auth session', async () => {
    const res = await request(app)
      .post('/api/public/mollie/payment-links/webhook')
      .send('id=tr_noauth')
      .set('Content-Type', 'application/x-www-form-urlencoded')
    expect([200]).toContain(res.status)
  })

  it('payment-link creation requires auth', async () => {
    const res = await request(app).post('/api/invoices/1/payment-link').send({})
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review finding #1: GET /api/invoices/:id must not leak mollie_api_key
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/invoices/:id — Mollie key hardening (review #1)', () => {
  it('does not include tenant.mollie_api_key in invoice detail response', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).get(`/api/invoices/${inv.id}`))
    expect(res.status).toBe(200)
    expect(res.body.tenant).toBeDefined()
    expect(res.body.tenant).not.toHaveProperty('mollie_api_key')
    // Verify the tenant object still contains expected display fields
    expect(res.body.tenant.band_name).toBe('Alpha Band')
  })

  it('does not include mollie_api_key at any top-level key of invoice detail', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).get(`/api/invoices/${inv.id}`))
    expect(JSON.stringify(res.body)).not.toContain('test_mollie_key_alpha')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review finding #4: Webhook must verify the posted payment id matches Mollie
// ─────────────────────────────────────────────────────────────────────────────

describe('Webhook payment id verification (review #4)', () => {
  it('does not update invoice when posted payment id mismatches Mollie payment', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    // Mollie reports paid for tr_real456 — but the webhook posts a different id.
    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{
        id: 'tr_real456', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00',
      }],
    }))

    const res = await request(app)
      .post(`/api/public/mollie/payment-links/webhook?invoice=${inv.id}`)
      .send('id=tr_forged999')
      .set('Content-Type', 'application/x-www-form-urlencoded')
    expect(res.status).toBe(200)

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    // Payment-link creation finalized the invoice to 'sent'; the forged-id
    // webhook does not promote it further, so it stays at 'sent'.
    expect(rows[0].status).toBe('sent')
    expect(rows[0].mollie_payment_id).toBeNull()  // unchanged by the forged webhook
  })

  it('does update invoice when posted payment id matches Mollie payment', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{
        id: 'tr_match', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00',
      }],
    }))

    await request(app)
      .post(`/api/public/mollie/payment-links/webhook?invoice=${inv.id}`)
      .send('id=tr_match')
      .set('Content-Type', 'application/x-www-form-urlencoded')

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('paid')
    expect(rows[0].mollie_payment_id).toBe('tr_match')
  })

  it('sync endpoint (no expectedPaymentId) still updates without a posted id', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{
        id: 'tr_real', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00',
      }],
    }))

    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link/sync`)).send()
    expect(res.status).toBe(200)
    expect(res.body.invoiceStatus).toBe('paid')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review finding #6: Validate optional expiresAt and allowedMethods
// ─────────────────────────────────────────────────────────────────────────────

describe('Payment-link option validation (review #6)', () => {
  it('rejects non-string expiresAt with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ expiresAt: 12345 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_expires_at')
    expect(mockPaymentLinksCreate).not.toHaveBeenCalled()
  })

  it('rejects unparseable expiresAt with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ expiresAt: 'not-a-date' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_expires_at')
  })

  it('rejects past expiresAt with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ expiresAt: '2020-01-01T00:00:00Z' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('expires_at_in_past')
  })

  it('accepts a future expiresAt and forwards it to Mollie', async () => {
    const inv = await createInvoiceA()
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ expiresAt: future })
    expect(res.status).toBe(201)
    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(expect.objectContaining({
      expiresAt: future,
    }))
  })

  it('rejects non-array allowedMethods with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ allowedMethods: 'ideal' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_allowed_methods')
  })

  it('rejects unsupported allowedMethods entry with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ allowedMethods: ['ideal', 'made-up-method'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unsupported_payment_method')
  })

  it('accepts supported allowedMethods and forwards them to Mollie', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ allowedMethods: ['ideal', 'creditcard'] })
    expect(res.status).toBe(201)
    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(expect.objectContaining({
      allowedMethods: ['ideal', 'creditcard'],
    }))
  })

  it('omits allowedMethods entirely when an empty array is sent', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ allowedMethods: [] })
    expect(res.status).toBe(201)
    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ allowedMethods: expect.anything() }),
    )
  })

  // Issue 2: methods that require extra Mollie request fields (lines, billingAddress)
  // are rejected by the conservative allowlist.
  it('rejects klarnapaylater (requires lines + billingAddress) with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ allowedMethods: ['klarnapaylater'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unsupported_payment_method')
  })

  it('rejects klarna (requires lines + billingAddress) with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ allowedMethods: ['klarna'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unsupported_payment_method')
  })

  it('rejects sofort (not in conservative list) with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ allowedMethods: ['sofort'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unsupported_payment_method')
  })

  it('rejects giftcard (requires extra fields) with 400', async () => {
    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`))
      .send({ allowedMethods: ['giftcard'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unsupported_payment_method')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review finding #7: Missing checkout URL must fail fast
// ─────────────────────────────────────────────────────────────────────────────

describe('Payment-link missing checkout URL (review #7)', () => {
  it('returns 502 and does not store the link when Mollie omits the URL', async () => {
    mockPaymentLinksCreate.mockResolvedValue({ id: 'pl_nourl', _links: {} })

    const inv = await createInvoiceA()
    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(502)
    expect(res.body.error).toBe('mollie_payment_link_url_missing')

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].mollie_payment_link_id).toBeNull()
    expect(rows[0].mollie_payment_link_url).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review finding #3: Concurrent payment-link creation produces a single link
// ─────────────────────────────────────────────────────────────────────────────

describe('Concurrent payment-link creation (review #3)', () => {
  it('two concurrent calls leave only one stored link on the invoice', async () => {
    const inv = await createInvoiceA()

    // Give each concurrent call a distinct Mollie id so we can tell which one
    // won the race; only one should make it into the DB.
    let count = 0
    mockPaymentLinksCreate.mockImplementation(async () => {
      count += 1
      return {
        id: `pl_race_${count}`,
        _links: { paymentLink: { href: `https://paymentlink.mollie.com/payment/race_${count}` } },
      }
    })

    const [r1, r2] = await Promise.all([
      asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({}),
      asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({}),
    ])

    // Both calls create successfully — the second one's Mollie link is
    // orphaned by the `mollie_payment_link_id IS NULL` guard on the final
    // UPDATE. (Finalize-first means both pass the in-tx existing-link check
    // before either has stored its id, so we cannot short-circuit B with a
    // 200 the way a strict serial sequential path would.)
    expect([r1.status, r2.status]).toEqual([201, 201])

    // Both responses report the same stored link
    expect(r1.body.mollie_payment_link_id).toBe(r2.body.mollie_payment_link_id)
    expect(r1.body.mollie_payment_link_url).toBe(r2.body.mollie_payment_link_url)

    // DB has exactly one of the two generated ids
    const { rows } = await pool.query(
      'SELECT mollie_payment_link_id FROM invoices WHERE id = $1', [inv.id])
    expect(['pl_race_1', 'pl_race_2']).toContain(rows[0].mollie_payment_link_id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review finding #5: syncInvoicePaymentStatus is tenant-scoped
// ─────────────────────────────────────────────────────────────────────────────

describe('syncInvoicePaymentStatus tenant scoping (review #5)', () => {
  it('UPDATE includes tenant_id so an invoice carrying the wrong tenant_id is a no-op', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    // Load the canonical invoice row, then tamper with its tenant_id to simulate
    // a stale or attacker-controlled invoice object reaching the sync helper.
    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    const tampered = { ...rows[0], tenant_id: seed.tenantB.id }

    const { syncInvoicePaymentStatus } = await import('../../../server/routes/invoices.js')
    const mollieMod = await import('../../../server/utils/mollieClient.js')
    const mollie = mollieMod.createTenantMollieClient('any')

    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{
        id: 'tr_x', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00',
      }],
    }))

    const result = await syncInvoicePaymentStatus(mollie, pool, tampered)
    // Update with tenant_id mismatch returns no row from RETURNING
    expect(result).toBeUndefined()

    // Original tenant A invoice is untouched — 'sent' because link creation finalized it.
    const { rows: after } = await pool.query('SELECT status FROM invoices WHERE id = $1', [inv.id])
    expect(after[0].status).toBe('sent')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review finding #2: Public webhook is rate-limited (configuration-only test;
// the limiter is bypassed in NODE_ENV=test, so we assert it's mounted)
// ─────────────────────────────────────────────────────────────────────────────

describe('Public webhook rate limiter (review #2)', () => {
  it('publicWebhookLimiter is wired before the /public/mollie router', async () => {
    // Re-read the routes file to confirm the limiter is referenced before the
    // router. This catches accidental ordering regressions in code review.
    const fs = await import('fs/promises')
    const path = await import('path')
    const url = await import('url')
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    const src = await fs.readFile(
      path.resolve(here, '../../../server/routes/index.js'),
      'utf8',
    )
    expect(src).toMatch(/publicWebhookLimiter[\s\S]*router\.use\('\/public\/mollie',\s*publicWebhookLimiter/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TOCTOU regression: a concurrent PATCH during the Mollie network call must
// not be able to mutate invoice content (lines, total_cents) underneath the
// already-priced payment link. Finalization happens BEFORE the Mollie call,
// so PATCH should observe finalized_at and 409 instead.
// ─────────────────────────────────────────────────────────────────────────────

describe('TOCTOU: concurrent PATCH during Mollie create is blocked', () => {
  it('PATCH of line items issued while Mollie create is in flight returns 409 and total_cents stays in sync with Mollie', async () => {
    const inv = await createInvoiceA()
    expect(inv.total_cents).toBe(50000)

    let patchResponse
    mockPaymentLinksCreate.mockImplementation(async () => {
      // While the payment-link route is awaiting Mollie, a separate request
      // attempts to bump line totals. Without the fix, this PATCH would
      // commit and leave invoice.total_cents diverged from the Mollie amount.
      patchResponse = await asUserA(request(app).patch(`/api/invoices/${inv.id}`)).send({
        lines: [{ description: 'Sneaky update', quantity: 1, unit_price_cents: 75000, tax_percentage: 0 }],
      })
      return {
        id: 'pl_toctou',
        _links: { paymentLink: { href: 'https://paymentlink.mollie.com/payment/toctou' } },
      }
    })

    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    expect(res.status).toBe(201)

    // Concurrent PATCH was rejected.
    expect(patchResponse.status).toBe(409)
    expect(patchResponse.body.code).toBe('invoice_finalized')

    // total_cents in DB matches the amount we sent to Mollie.
    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: { currency: 'EUR', value: '500.00' } }),
    )
    const { rows } = await pool.query('SELECT total_cents, status, finalized_at FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].total_cents).toBe(50000)
    expect(rows[0].status).toBe('sent')
    expect(rows[0].finalized_at).not.toBeNull()
  })
})
