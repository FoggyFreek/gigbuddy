import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

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
  IMAGE_PROCESSING_PRESETS: { invoiceLogo: { maxDimension: 800, quality: 90 } },
  extensionForImageMime: vi.fn(() => '.png'),
  validateAndReencodeImage: vi.fn(async (buffer) => ({ buffer, size: buffer.length, mimetype: 'image/png' })),
}))

const mockPaymentLinksCreate = vi.fn()
const mockPaymentLinksGet = vi.fn()
const mockPaymentLinksDelete = vi.fn()
const mockPaymentLinksUpdate = vi.fn()

vi.mock('../../../server/finance/invoices/molliePaymentLinkGateway.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createTenantMolliePaymentLinkGateway: vi.fn(() => ({
      createPaymentLink: mockPaymentLinksCreate,
      getPaymentSnapshot: mockPaymentLinksGet,
      deletePaymentLink: mockPaymentLinksDelete,
      archivePaymentLink: mockPaymentLinksUpdate,
    })),
  }
})

const mockSendPushToUsers = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../server/utils/sendPush.js', () => ({
  sendPushToTenant: vi.fn().mockResolvedValue(undefined),
  sendPushToMember: vi.fn().mockResolvedValue(undefined),
  sendPushToUsers: mockSendPushToUsers,
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, setIntegrationCredential
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  ;({ setIntegrationCredential } = await import('../../../server/platform/integrations/integrationCredentialService.js'))
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  const fixtureDb = await import('./_db.js')
  seed = await fixtureDb.seedContactsAndVenues(seed)
  seed = await fixtureDb.seedAccountingForTenants(seed)
  await pool.query('UPDATE tenants SET band_name = $1 WHERE id = $2', ['Alpha Band', seed.tenantA.id])
  await setIntegrationCredential(pool, seed.tenantA.id, 'mollie_api_key', 'test_mollie_key_alpha')
  vi.clearAllMocks()
  delete process.env.APP_URL
  delete process.env.MOLLIE_WEBHOOK_BASE_URL
  delete process.env.MOLLIE_DISABLE_WEBHOOK
  mockPaymentLinksCreate.mockResolvedValue({
    id: 'pl_test123',
    checkoutUrl: 'https://paymentlink.mollie.com/payment/test123',
  })
  mockPaymentLinksGet.mockResolvedValue(mockPaymentLink())
  mockPaymentLinksDelete.mockResolvedValue(undefined)
  mockPaymentLinksUpdate.mockResolvedValue(undefined)
  mockSendPushToUsers.mockResolvedValue(undefined)
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
    customer_address_street: 'Hall Street 3',
    customer_address_city: 'Utrecht',
    issue_date: '2026-05-01',
    payment_term_days: 14,
    lines: [{ description: 'Performance', quantity: 1, unit_price_cents: 50000, tax_percentage: 0 }],
    ...overrides,
  })
  expect(res.status).toBe(201)
  return res.body
}

async function createLinkedInvoiceA() {
  const invoice = await createInvoiceA()
  mockPaymentLinksCreate.mockResolvedValueOnce({
    id: `pl_test_${invoice.id}`,
    checkoutUrl: `https://paymentlink.mollie.com/payment/${invoice.id}`,
  })
  await asUserA(request(app).post(`/api/invoices/${invoice.id}/payment-link`)).send({}).expect(201)
  return invoice
}

function mockPaymentLink({ status = 'open', payments = [] } = {}) {
  return { status, latestPayment: payments[0] ?? null }
}

function mollieError(statusCode) {
  return Object.assign(new Error(`mollie ${statusCode}`), { statusCode })
}

function postWebhook(invoiceId, paymentId = 'tr_hint') {
  return request(app)
    .post(`/api/public/mollie/payment-links/webhook?invoice=${invoiceId}`)
    .send(`id=${paymentId}`)
    .set('Content-Type', 'application/x-www-form-urlencoded')
}

describe('Mollie payment-link lifecycle', () => {
  it('creates a link from the final invoice total and atomically persists the finalized invoice', async () => {
    process.env.APP_URL = 'https://app.example.com'
    process.env.MOLLIE_WEBHOOK_BASE_URL = 'https://api.example.com'
    const invoice = await createInvoiceA()

    const res = await asUserA(request(app).post(`/api/invoices/${invoice.id}/payment-link`)).send({})

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      status: 'sent',
      mollie_payment_link_id: 'pl_test123',
      mollie_payment_link_url: 'https://paymentlink.mollie.com/payment/test123',
    })
    expect(res.body.finalized_at).not.toBeNull()
    expect(mockPaymentLinksCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: { currency: 'EUR', value: '500.00' },
      redirectUrl: `https://app.example.com/payment/thanks?invoice=${invoice.id}&band=Alpha+Band`,
      webhookUrl: `https://api.example.com/api/public/mollie/payment-links/webhook?invoice=${invoice.id}`,
      reusable: false,
    }))
  })

  it('rejects invalid payment-link states without storing a partial link', async () => {
    const zero = await createInvoiceA({
      lines: [{ description: 'Free', quantity: 1, unit_price_cents: 0, tax_percentage: 0 }],
    })
    await asUserA(request(app).post(`/api/invoices/${zero.id}/payment-link`)).send({}).expect(400)

    const voidInvoice = await createInvoiceA()
    await asUserA(request(app).patch(`/api/invoices/${voidInvoice.id}`)).send({ status: 'void' }).expect(200)
    await asUserA(request(app).post(`/api/invoices/${voidInvoice.id}/payment-link`)).send({}).expect(400)

    mockPaymentLinksCreate.mockResolvedValueOnce({ id: 'pl_missing_url', checkoutUrl: null })
    const missingUrl = await createInvoiceA()
    const response = await asUserA(request(app).post(`/api/invoices/${missingUrl.id}/payment-link`)).send({})
    expect(response.status).toBe(502)
    const { rows } = await pool.query('SELECT mollie_payment_link_id FROM invoices WHERE id = $1', [missingUrl.id])
    expect(rows[0].mollie_payment_link_id).toBeNull()
  })

  it('returns the stored link on a duplicate create without a second provider call', async () => {
    const invoice = await createInvoiceA()
    const first = await asUserA(request(app).post(`/api/invoices/${invoice.id}/payment-link`)).send({})
    const second = await asUserA(request(app).post(`/api/invoices/${invoice.id}/payment-link`)).send({})

    expect([first.status, second.status]).toEqual([201, 200])
    expect(second.body.mollie_payment_link_id).toBe(first.body.mollie_payment_link_id)
    expect(mockPaymentLinksCreate).toHaveBeenCalledTimes(1)
  })

  it('does not expose or mutate a foreign tenant invoice', async () => {
    const invoice = await createInvoiceA()
    await asUserB(request(app).post(`/api/invoices/${invoice.id}/payment-link`)).send({}).expect(404)
    expect(mockPaymentLinksCreate).not.toHaveBeenCalled()
  })

  it('syncs a paid provider snapshot once and posts the cash journal once', async () => {
    const invoice = await createLinkedInvoiceA()
    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{ id: 'tr_paid', status: 'paid', paidAt: '2026-05-15T10:00:00+00:00' }],
    }))

    await asUserA(request(app).post(`/api/invoices/${invoice.id}/payment-link/sync`)).send().expect(200)
    const second = await asUserA(request(app).post(`/api/invoices/${invoice.id}/payment-link/sync`)).send()

    expect(second.body).toMatchObject({ paymentId: 'tr_paid', invoiceStatus: 'paid' })
    const { rows: invoices } = await pool.query('SELECT status, mollie_payment_id FROM invoices WHERE id = $1', [invoice.id])
    const { rows: paidJournals } = await pool.query(
      "SELECT 1 FROM ledger_transactions WHERE tenant_id = $1 AND source_type = 'invoice' AND source_id = $2 AND source_event = 'paid'",
      [seed.tenantA.id, invoice.id],
    )
    expect(invoices[0]).toMatchObject({ status: 'paid', mollie_payment_id: 'tr_paid' })
    expect(paidJournals).toHaveLength(1)
  })

  it('uses the authoritative webhook snapshot and notifies only on its first paid transition', async () => {
    const invoice = await createLinkedInvoiceA()
    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid',
      payments: [{ id: 'tr_authoritative', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00' }],
    }))

    await postWebhook(invoice.id, 'tr_untrusted_hint').expect(200)
    await postWebhook(invoice.id, 'tr_untrusted_hint').expect(200)

    const { rows } = await pool.query('SELECT status, mollie_payment_id FROM invoices WHERE id = $1', [invoice.id])
    expect(rows[0]).toMatchObject({ status: 'paid', mollie_payment_id: 'tr_authoritative' })
    expect(mockSendPushToUsers).toHaveBeenCalledTimes(1)
    expect(mockSendPushToUsers).toHaveBeenCalledWith(expect.any(Array), seed.tenantA.id, expect.any(Object))
  })

  it('does not settle or notify for an open payment or a void invoice', async () => {
    const openInvoice = await createLinkedInvoiceA()
    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'open', payments: [{ id: 'tr_open', status: 'open' }],
    }))
    await postWebhook(openInvoice.id).expect(200)

    const voidInvoice = await createLinkedInvoiceA()
    await pool.query("UPDATE invoices SET status = 'void' WHERE id = $1", [voidInvoice.id])
    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid', payments: [{ id: 'tr_void', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00' }],
    }))
    await postWebhook(voidInvoice.id).expect(200)

    const { rows } = await pool.query('SELECT id, status FROM invoices WHERE id = ANY($1)', [[openInvoice.id, voidInvoice.id]])
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: openInvoice.id, status: 'sent' }),
      expect.objectContaining({ id: voidInvoice.id, status: 'void' }),
    ]))
    expect(mockSendPushToUsers).not.toHaveBeenCalled()
  })

  it('removes, archives, or protects a payment link according to the authoritative provider outcome', async () => {
    const deleted = await createLinkedInvoiceA()
    await asUserA(request(app).delete(`/api/invoices/${deleted.id}/payment-link`)).expect(200)

    const archived = await createLinkedInvoiceA()
    mockPaymentLinksDelete.mockRejectedValueOnce(mollieError(422))
    mockPaymentLinksGet.mockResolvedValueOnce(mockPaymentLink({
      payments: [{ id: 'tr_failed', status: 'failed' }],
    }))
    await asUserA(request(app).delete(`/api/invoices/${archived.id}/payment-link`)).expect(200)

    const paid = await createLinkedInvoiceA()
    mockPaymentLinksDelete.mockRejectedValueOnce(mollieError(422))
    mockPaymentLinksGet.mockResolvedValueOnce(mockPaymentLink({
      status: 'paid', payments: [{ id: 'tr_paid', status: 'paid', paidAt: '2026-05-20T12:00:00+00:00' }],
    }))
    await asUserA(request(app).delete(`/api/invoices/${paid.id}/payment-link`)).expect(409)

    const { rows } = await pool.query(
      'SELECT id, status, mollie_payment_link_id FROM invoices WHERE id = ANY($1)',
      [[deleted.id, archived.id, paid.id]],
    )
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: deleted.id, mollie_payment_link_id: null }),
      expect.objectContaining({ id: archived.id, mollie_payment_link_id: null }),
      expect.objectContaining({ id: paid.id, status: 'paid', mollie_payment_link_id: `pl_test_${paid.id}` }),
    ]))
    expect(mockPaymentLinksUpdate).toHaveBeenCalledWith(`pl_test_${archived.id}`)
  })

  it('serializes duplicate creation and blocks content changes while the provider call is in flight', async () => {
    const invoice = await createInvoiceA()
    let secondRequest
    let patchResponse
    mockPaymentLinksCreate.mockImplementationOnce(async () => {
      patchResponse = await asUserA(request(app).patch(`/api/invoices/${invoice.id}`)).send({
        lines: [{ description: 'Changed', quantity: 1, unit_price_cents: 75000, tax_percentage: 0 }],
      })
      secondRequest = asUserA(request(app).post(`/api/invoices/${invoice.id}/payment-link`)).send({}).then((result) => result)
      await new Promise((resolve) => setImmediate(resolve))
      expect(mockPaymentLinksCreate).toHaveBeenCalledTimes(1)
      return { id: 'pl_race', checkoutUrl: 'https://paymentlink.mollie.com/payment/race' }
    })

    const first = await asUserA(request(app).post(`/api/invoices/${invoice.id}/payment-link`)).send({})
    expect(patchResponse.status).toBe(409)
    const second = await secondRequest
    expect([first.status, second.status].sort()).toEqual([200, 201])
  })

  it('posts a late webhook cash receipt on the first open accounting day', async () => {
    const invoice = await createLinkedInvoiceA()
    await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ books_closed_through: '2026-05-31' }).expect(200)
    mockPaymentLinksGet.mockResolvedValue(mockPaymentLink({
      status: 'paid', payments: [{ id: 'tr_late', status: 'paid', paidAt: '2026-05-15T10:00:00+00:00' }],
    }))

    await postWebhook(invoice.id, 'tr_late').expect(200)

    const { rows } = await pool.query(
      `SELECT to_char(entry_date, 'YYYY-MM-DD') AS entry_date
         FROM ledger_transactions
        WHERE tenant_id = $1 AND source_type = 'invoice' AND source_id = $2 AND source_event = 'paid'`,
      [seed.tenantA.id, invoice.id],
    )
    expect(rows).toEqual([{ entry_date: '2026-06-01' }])
  })
})
