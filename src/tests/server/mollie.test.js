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
const mockPaymentLinksListPayments = vi.fn()

vi.mock('../../../server/utils/mollieClient.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createTenantMollieClient: vi.fn(() => ({
      paymentLinks: {
        create: mockPaymentLinksCreate,
        get: mockPaymentLinksGet,
        listPayments: mockPaymentLinksListPayments,
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

  // Default Mollie mock: successful payment link creation.
  mockPaymentLinksCreate.mockResolvedValue({
    id: 'pl_test123',
    _links: { paymentLink: { href: 'https://paymentlink.mollie.com/payment/test123', type: 'text/html' } },
  })

  // Default sync mock: open status, no payment yet.
  mockPaymentLinksGet.mockResolvedValue({ id: 'pl_test123', status: 'open' })
  mockPaymentLinksListPayments.mockResolvedValue([])
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
    expect(res.body.paymentLinkId).toBe('pl_test123')
    expect(res.body.paymentLinkUrl).toBe('https://paymentlink.mollie.com/payment/test123')
    expect(res.body.status).toBe('open')

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
      redirectUrl: `https://app.example.com/payment/thanks?invoice=${inv.id}`,
      webhookUrl: `https://api.example.com/api/public/mollie/payment-links/webhook?invoice=${inv.id}`,
      reusable: false,
    }))
    delete process.env.APP_URL
    delete process.env.MOLLIE_WEBHOOK_BASE_URL
  })

  it('returns existing link instead of creating a duplicate', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})
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

    mockPaymentLinksGet.mockResolvedValue({ id: 'pl_test123', status: 'paid' })
    mockPaymentLinksListPayments.mockResolvedValue([{
      id: 'tr_test456',
      status: 'paid',
      paidAt: '2026-05-15T10:00:00+00:00',
    }])

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

    mockPaymentLinksGet.mockResolvedValue({ id: 'pl_test123', status: 'open' })
    mockPaymentLinksListPayments.mockResolvedValue([{
      id: 'tr_test456', status: 'open',
    }])

    const res = await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link/sync`)).send()
    expect(res.status).toBe(200)
    expect(res.body.invoiceStatus).toBe('draft')

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('draft')
  })

  it('is idempotent for paid status', async () => {
    const inv = await createInvoiceA()
    await asUserA(request(app).post(`/api/invoices/${inv.id}/payment-link`)).send({})

    mockPaymentLinksGet.mockResolvedValue({ id: 'pl_test123', status: 'paid' })
    mockPaymentLinksListPayments.mockResolvedValue([{
      id: 'tr_test456', status: 'paid', paidAt: '2026-05-15T10:00:00+00:00',
    }])

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

    mockPaymentLinksGet.mockResolvedValue({ id: 'pl_test123', status: 'paid' })
    mockPaymentLinksListPayments.mockResolvedValue([{
      id: 'tr_webhook456', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00',
    }])

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

    mockPaymentLinksGet.mockResolvedValue({ id: 'pl_test123', status: 'open' })
    mockPaymentLinksListPayments.mockResolvedValue([{ id: 'tr_open', status: 'open' }])

    await request(app)
      .post(`/api/public/mollie/payment-links/webhook?invoice=${inv.id}`)
      .send('id=tr_open')
      .set('Content-Type', 'application/x-www-form-urlencoded')

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id])
    expect(rows[0].status).toBe('draft')
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

    mockPaymentLinksGet.mockResolvedValue({ id: 'pl_test123', status: 'paid' })
    mockPaymentLinksListPayments.mockResolvedValue([{
      id: 'tr_dup', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00',
    }])

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
