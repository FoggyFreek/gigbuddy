import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import request from 'supertest'

// The stored PDF has to be readable — an invoice email without its invoice is a
// hard error, not a silent omission.
vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async () => ({ etag: 'test' })),
    getObject: vi.fn(async () => Readable.from([Buffer.from('%PDF-1.7 invoice')])),
    statObject: vi.fn(async () => ({ size: 0, metaData: {} })),
    removeObject: vi.fn(async () => undefined),
  },
}))

// Never call the real provider. The mock records what would have been sent.
const sent = []
vi.mock('resend', () => ({
  Resend: class {
    constructor() {
      this.emails = {
        send: vi.fn(async (payload, options) => {
          sent.push({ payload, options })
          return { data: { id: `provider-${sent.length}` }, error: null }
        }),
      }
      this.batch = { send: vi.fn(async () => ({ data: { data: [] }, error: null })) }
    }
  },
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants
let setIntegrationCredential, CREDENTIAL_TYPES
let seed

beforeAll(async () => {
  const db = await import('./_db.js')
  const appModule = await import('./_app.js')
  ;({ pool, runMigrations, truncateAll, seedTwoTenants } = db)
  ;({ setIntegrationCredential } = await import('../../../server/platform/integrations/integrationCredentialService.js'))
  ;({ CREDENTIAL_TYPES } = await import('../../../server/security/integrationSecrets.js'))
  app = appModule.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  sent.length = 0
  await truncateAll()
  seed = await seedTwoTenants()
  const fixtureDb = await import('./_db.js')
  seed = await fixtureDb.seedAccountingForTenants(seed)
})

afterAll(async () => { await pool.end() })

const asUserA = (req) => req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))
const asUserB = (req) => req.set('x-test-user-id', String(seed.userB.id)).set('x-test-tenant-id', String(seed.tenantB.id))

async function configureSender(tenantId = seed.tenantA.id) {
  await setIntegrationCredential(pool, tenantId, CREDENTIAL_TYPES.RESEND_API_KEY, 're_test_key')
  await pool.query(
    `UPDATE tenants SET outreach_from_name = 'Example Band', outreach_from_email = 'hello@example.test'
      WHERE id = $1`,
    [tenantId],
  )
}

async function createTemplate(as = asUserA) {
  const res = await as(request(app).post('/api/outreach/templates').send({
    name: 'Invoice mail',
    context: 'invoice',
    subject: 'Factuur {{invoice.number}}',
    body_html: '<p>{{customer.greeting}}</p>{{#message}}',
    body_text: '{{customer.greeting}}',
  })).expect(201)
  return res.body
}

async function createInvoice(overrides = {}, as = asUserA) {
  const res = await as(request(app).post('/api/invoices').send({
    customer_name: 'Venue BV',
    customer_email: 'customer@example.test',
    customer_address_street: 'Hall Street 3',
    customer_address_postal_code: '3000 CC',
    customer_address_city: 'Utrecht',
    issue_date: '2026-03-01',
    payment_term_days: 14,
    lines: [{ description: 'Show', quantity: 1, unit_price_cents: 50000, tax_percentage: 21 }],
    ...overrides,
  })).expect(201)
  return res.body
}

describe('invoice email — sending', () => {
  it('creates a campaign and delivers it with the invoice attached', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice()

    const campaign = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`)
      .send({ message: 'Bedankt!' })).expect(201)
    expect(campaign.body.type).toBe('invoice')
    expect(campaign.body.invoice_id).toBe(invoice.id)
    expect(campaign.body.recipients).toHaveLength(1)

    const result = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/send`)
      .send({ campaignId: campaign.body.id })).expect(200)

    expect(result.body.status).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.to).toBe('customer@example.test')
    expect(sent[0].payload.attachments[0].filename).toMatch(/\.pdf$/)
    // Transactional mail carries no marketing unsubscribe headers.
    expect(sent[0].payload.headers).toBeUndefined()
  })

  it('delivers only once when the same send is replayed', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice()
    const campaign = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`).send({})).expect(201)

    await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/send`)
      .send({ campaignId: campaign.body.id })).expect(200)
    await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/send`)
      .send({ campaignId: campaign.body.id })).expect(200)

    expect(sent).toHaveLength(1)
  })

  it('attaches the e-invoice XML when requested', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice()
    const campaign = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`)
      .send({ attachments: 'pdf_xml' })).expect(201)

    await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/send`)
      .send({ campaignId: campaign.body.id })).expect(200)

    const names = sent[0].payload.attachments.map((file) => file.filename)
    expect(names.some((name) => name.endsWith('.pdf'))).toBe(true)
    expect(names.some((name) => name.endsWith('.xml'))).toBe(true)
  })

  it('sends an invoice even to a suppressed address', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice()
    await pool.query(
      "INSERT INTO outreach_suppressions (tenant_id, email, reason) VALUES ($1, 'customer@example.test', 'manual')",
      [seed.tenantA.id],
    )
    const campaign = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`).send({})).expect(201)

    await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/send`)
      .send({ campaignId: campaign.body.id })).expect(200)

    expect(sent).toHaveLength(1)
  })

  it('can be emailed again after the invoice was marked sent', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice()
    const patched = await asUserA(request(app).patch(`/api/invoices/${invoice.id}`).send({ status: 'sent' })).expect(200)
    expect(patched.body.status).toBe('sent')

    const campaign = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`).send({})).expect(201)
    await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/send`)
      .send({ campaignId: campaign.body.id })).expect(200)

    expect(sent).toHaveLength(1)
  })

  it('refuses to send without a configured Resend sender', async () => {
    await createTemplate()
    const invoice = await createInvoice()
    const res = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`).send({}))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('sender_not_configured')
  })

  it('refuses an invoice with no customer email address', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice({ customer_email: null })
    const res = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`).send({}))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invoice_customer_email_missing')
  })

  it('returns 404 for another tenant\'s invoice', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice()
    await asUserB(request(app).post(`/api/invoices/${invoice.id}/email/campaign`).send({})).expect(404)
    await asUserB(request(app).get(`/api/invoices/${invoice.id}/email/defaults`)).expect(404)
  })

  it('will not send a campaign that belongs to another invoice', async () => {
    await configureSender()
    await createTemplate()
    const first = await createInvoice()
    const second = await createInvoice()
    const campaign = await asUserA(request(app).post(`/api/invoices/${first.id}/email/campaign`).send({})).expect(201)

    await asUserA(request(app).post(`/api/invoices/${second.id}/email/send`)
      .send({ campaignId: campaign.body.id })).expect(404)
    expect(sent).toHaveLength(0)
  })

  it('lists invoice sends in the campaign history under its own type', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice()
    const campaign = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`).send({})).expect(201)
    await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/send`)
      .send({ campaignId: campaign.body.id })).expect(200)

    const listed = await asUserA(request(app).get('/api/outreach/campaigns?type=invoice')).expect(200)
    expect(listed.body.items).toHaveLength(1)
    expect(listed.body.items[0].type).toBe('invoice')

    const outreachOnly = await asUserA(request(app).get('/api/outreach/campaigns?type=outreach')).expect(200)
    expect(outreachOnly.body.items).toHaveLength(0)
  })

  it('keeps the send history when the invoice is deleted', async () => {
    await configureSender()
    await createTemplate()
    const invoice = await createInvoice()
    const campaign = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/campaign`).send({})).expect(201)

    // The composite FK nulls ONLY invoice_id; tenant_id is NOT NULL and must
    // survive, which a plain ON DELETE SET NULL would break.
    await asUserA(request(app).delete(`/api/invoices/${invoice.id}`)).expect(204)

    const { rows } = await pool.query(
      'SELECT tenant_id, invoice_id, type FROM outreach_campaigns WHERE id = $1',
      [campaign.body.id],
    )
    expect(rows[0]).toMatchObject({ tenant_id: seed.tenantA.id, invoice_id: null, type: 'invoice' })
  })
})

describe('invoice email — defaults and preview', () => {
  it('reports the available templates and a default message', async () => {
    await createTemplate()
    const invoice = await createInvoice()
    const res = await asUserA(request(app).get(`/api/invoices/${invoice.id}/email/defaults`)).expect(200)
    expect(res.body.templates).toHaveLength(1)
    expect(res.body.message).toBeTruthy()
    expect(res.body.to).toBe('customer@example.test')
  })

  it('reports no templates rather than failing when none exist', async () => {
    const invoice = await createInvoice()
    const res = await asUserA(request(app).get(`/api/invoices/${invoice.id}/email/defaults`)).expect(200)
    expect(res.body.templates).toEqual([])
  })

  it('renders a preview with the custom message and an inlined QR', async () => {
    await createTemplate()
    const invoice = await createInvoice()
    const res = await asUserA(request(app).post(`/api/invoices/${invoice.id}/email/preview`)
      .send({ message: 'Dank voor de samenwerking' })).expect(200)
    expect(res.body.subject).toContain(invoice.invoice_number)
    expect(res.body.html).toContain('Dank voor de samenwerking')
    // cid: cannot resolve in the preview iframe, so nothing may reference it.
    expect(res.body.html).not.toContain('cid:')
  })
})
