import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'

const storageMocks = vi.hoisted(() => ({
  uploadObjectWithQuota: vi.fn(async () => undefined),
}))

vi.mock('../../../server/platform/files/storageService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadObjectWithQuota: storageMocks.uploadObjectWithQuota,
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, billing, clearEntitlementCaches
let seed

beforeAll(async () => {
  const db = await import('./_db.js')
  const appModule = await import('./_app.js')
  ;({ pool, runMigrations, truncateAll, seedTwoTenants } = db)
  billing = await import('./_billing.js')
  ;({ clearEntitlementCaches } = await import('../../../server/entitlements/entitlementResolver.js'))
  app = appModule.createTestApp()
  await runMigrations()
})
beforeEach(async () => {
  storageMocks.uploadObjectWithQuota.mockClear()
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  clearEntitlementCaches()
})
afterAll(async () => { await pool.end() })

const asUserA = (req) => req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))

describe('outreach templates', () => {
  it('creates, reads and lists through a bounded envelope', async () => {
    const created = await asUserA(request(app).post('/api/outreach/templates').send({
      name: 'Booking pitch', subject: 'Hello {{venue.name}}',
      body_json: { type: 'doc' }, body_html: '<p>Hello {{contact.first_name}}</p>', body_text: 'Hello {{contact.first_name}}',
    })).expect(201)
    await asUserA(request(app).get(`/api/outreach/templates/${created.body.id}`)).expect(200)
    const listed = await asUserA(request(app).get('/api/outreach/templates?limit=1')).expect(200)
    expect(listed.body.meta).toEqual({ limit: 1, returned: 1 })
    expect(listed.body.items[0].name).toBe('Booking pitch')
  })

  it('returns 404 for cross-tenant reads and writes', async () => {
    const { rows: [other] } = await pool.query(
      "INSERT INTO outreach_templates (tenant_id, name) VALUES ($1, 'Private') RETURNING id",
      [seed.tenantB.id],
    )
    await asUserA(request(app).get(`/api/outreach/templates/${other.id}`)).expect(404)
    await asUserA(request(app).patch(`/api/outreach/templates/${other.id}`).send({ name: 'Leaked' })).expect(404)
    await asUserA(request(app).delete(`/api/outreach/templates/${other.id}`)).expect(404)
    await asUserA(request(app).post(`/api/outreach/templates/${other.id}/copy`)).expect(404)
  })

  it('copies the complete template with incrementing Copy names', async () => {
    const original = await asUserA(request(app).post('/api/outreach/templates').send({
      name: 'Test1', locale: 'en', subject: 'Original subject',
      preview_text: 'Preview', body_json: { type: 'doc', content: [{ type: 'paragraph' }] },
      body_html: '<p>Original</p>', body_text: 'Original', origin_key: 'custom-origin',
    })).expect(201)

    const first = await asUserA(request(app).post(`/api/outreach/templates/${original.body.id}/copy`)).expect(201)
    expect(first.body).toMatchObject({
      name: 'Test1 Copy', locale: 'en', subject: 'Original subject',
      preview_text: 'Preview', body_json: { type: 'doc', content: [{ type: 'paragraph' }] },
      body_html: '<p>Original</p>', body_text: 'Original', origin_key: 'custom-origin',
    })

    const second = await asUserA(request(app).post(`/api/outreach/templates/${first.body.id}/copy`)).expect(201)
    expect(second.body.name).toBe('Test1 Copy(1)')
    const third = await asUserA(request(app).post(`/api/outreach/templates/${second.body.id}/copy`)).expect(201)
    expect(third.body.name).toBe('Test1 Copy(2)')
  })

  it('keeps reads available but blocks writes after an outreach downgrade', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    clearEntitlementCaches()
    await asUserA(request(app).get('/api/outreach/templates?limit=10')).expect(200)
    const denied = await asUserA(request(app).post('/api/outreach/templates').send({ name: 'No' })).expect(403)
    expect(denied.body).toMatchObject({ code: 'entitlement_required', feature: 'outreach' })
  })

  it('returns the scoped field view and live band sample', async () => {
    await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, bandsintown_artist_id)
       VALUES ($1, '15556138')`,
      [seed.tenantA.id],
    )
    const fields = await asUserA(request(app).get('/api/outreach/fields?locale=en')).expect(200)
    expect(fields.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'band.name', scope: 'band' }),
      expect.objectContaining({ key: 'venue.name', scope: 'venue' }),
      expect.objectContaining({ key: 'band.bandsintown_artist_id', sample: '15556138' }),
    ]))
    expect(fields.body.map((field) => field.key)).not.toEqual(expect.arrayContaining([
      'gig.date', 'deal.summary', 'contract.reference',
    ]))
  })
})

describe('gig contracts', () => {
  it('upgrades the legacy contract-template columns before generation', async () => {
    await pool.query(`
      ALTER TABLE gig_contracts
        ADD COLUMN template_id INTEGER,
        ADD COLUMN body_html TEXT NOT NULL
    `)
    const migration = await readFile(
      new URL('../../../server/db/migrations/206_drop_legacy_contract_template_fields.sql', import.meta.url),
      'utf8',
    )
    await pool.query(migration)

    const { rows: legacyColumns } = await pool.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'gig_contracts'
         AND column_name IN ('template_id', 'body_html')
    `)
    expect(legacyColumns).toEqual([])

    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (tenant_id, name, category)
       VALUES ($1, 'Upgraded Contract Venue', 'venue') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      'UPDATE gigs SET venue_id = $1 WHERE id = $2 AND tenant_id = $3',
      [venue.id, seed.gigA.id, seed.tenantA.id],
    )
    await asUserA(request(app).post(`/api/gigs/${seed.gigA.id}/contracts`)
      .send({ lng: 'nl' })).expect(201)
  })

  it('generates and stores a PDF for a gig with a venue', async () => {
    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (tenant_id, name, category)
       VALUES ($1, 'Contract Venue', 'venue') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      'UPDATE gigs SET venue_id = $1 WHERE id = $2 AND tenant_id = $3',
      [venue.id, seed.gigA.id, seed.tenantA.id],
    )

    const response = await asUserA(request(app).post(`/api/gigs/${seed.gigA.id}/contracts`)
      .send({ lng: 'en' })).expect(201)

    expect(response.body).toMatchObject({
      gig_id: seed.gigA.id,
      reference: expect.stringMatching(/^\d{4}-0001$/),
      version: 1,
      locale: 'en',
      status: 'draft',
      pdf_object_key: expect.stringMatching(new RegExp(`^tenants/${seed.tenantA.id}/contracts/.+\\.pdf$`)),
    })
    expect(storageMocks.uploadObjectWithQuota).toHaveBeenCalledWith(
      response.body.pdf_object_key,
      expect.any(Buffer),
      expect.any(Number),
      'application/pdf',
    )
    const { rows: [stored] } = await pool.query(
      'SELECT terms_snapshot FROM gig_contracts WHERE id = $1 AND tenant_id = $2',
      [response.body.id, seed.tenantA.id],
    )
    expect(stored.terms_snapshot).toMatchObject({
      gig: expect.objectContaining({ id: seed.gigA.id, venue_id: venue.id }),
      costs: expect.any(Array),
      venue: expect.objectContaining({ id: venue.id, name: 'Contract Venue' }),
      tenant: expect.objectContaining({ display_name: expect.any(String) }),
    })
    expect(stored.terms_snapshot.gig).not.toHaveProperty('venue_capacity')
    expect(stored.terms_snapshot.gig).not.toHaveProperty('expected_visitors')
  })

  it('returns 404 when another tenant gig is used for contract reads or generation', async () => {
    await asUserA(request(app).get(`/api/gigs/${seed.gigB.id}/contracts?limit=10`)).expect(404)
    await asUserA(request(app).post(`/api/gigs/${seed.gigB.id}/contracts`).send({ lng: 'en' })).expect(404)
  })
})

describe('outreach campaigns', () => {
  async function campaignFixture() {
    await pool.query(
      `UPDATE tenants SET outreach_from_name = 'Test Band', outreach_from_email = 'hello@test.example'
        WHERE id = $1`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, resend_api_key_encrypted)
       VALUES ($1, '{}'::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET resend_api_key_encrypted = EXCLUDED.resend_api_key_encrypted`,
      [seed.tenantA.id],
    )
    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (tenant_id, name, category, email)
       VALUES ($1, 'Test Venue', 'venue', 'venue@test.example') RETURNING *`,
      [seed.tenantA.id],
    )
    const { rows: [contact] } = await pool.query(
      `INSERT INTO contacts (tenant_id, name, email)
       VALUES ($1, 'Primary Person', 'contact@test.example') RETURNING *`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO venue_contacts (tenant_id, venue_id, contact_id, is_primary)
       VALUES ($1, $2, $3, true)`,
      [seed.tenantA.id, venue.id, contact.id],
    )
    const template = await asUserA(request(app).post('/api/outreach/templates').send({
      name: 'Venue campaign', subject: 'Hello {{venue.name}}',
      body_json: { type: 'doc' }, body_html: '<p>Hello {{contact.name}}</p>', body_text: 'Hello {{contact.name}}',
    })).expect(201)
    return { venue, contact, template: template.body }
  }

  it('resolves either the venue address or primary contact address for a campaign', async () => {
    const { venue, contact, template } = await campaignFixture()

    const venueCampaign = await asUserA(request(app).post('/api/outreach/campaigns').send({
      templateId: template.id,
      recipients: [{ venueId: venue.id, contactId: contact.id, addressSource: 'venue' }],
    })).expect(201)
    expect(venueCampaign.body.recipients[0]).toMatchObject({
      venue_id: venue.id, contact_id: contact.id, to_email: 'venue@test.example', to_name: 'Test Venue', status: 'pending',
    })

    const contactCampaign = await asUserA(request(app).post('/api/outreach/campaigns').send({
      templateId: template.id,
      recipients: [{ venueId: venue.id, contactId: contact.id, addressSource: 'primary_contact' }],
    })).expect(201)
    expect(contactCampaign.body.recipients[0]).toMatchObject({
      venue_id: venue.id, contact_id: contact.id, to_email: 'contact@test.example', to_name: 'Primary Person', status: 'pending',
    })
  })

  it('attaches a generated contract with an ordinary venue email template', async () => {
    const { venue, contact, template } = await campaignFixture()
    await pool.query(
      'UPDATE gigs SET venue_id = $1 WHERE id = $2 AND tenant_id = $3',
      [venue.id, seed.gigA.id, seed.tenantA.id],
    )
    const { rows: [contract] } = await pool.query(
      `INSERT INTO gig_contracts
        (tenant_id, gig_id, reference, version, locale, terms_snapshot, pdf_object_key)
       VALUES ($1, $2, '2026-0001', 1, 'en', $3, 'tenants/test/contracts/example.pdf')
       RETURNING id`,
      [seed.tenantA.id, seed.gigA.id, { gig: { venue_id: venue.id }, venue: { id: venue.id } }],
    )

    const campaign = await asUserA(request(app).post('/api/outreach/campaigns').send({
      templateId: template.id,
      contractId: contract.id,
      recipients: [{ venueId: venue.id, contactId: contact.id }],
    })).expect(201)

    expect(campaign.body).toMatchObject({ template_id: template.id, contract_id: contract.id })
    expect(campaign.body.recipients[0]).toMatchObject({ venue_id: venue.id, contact_id: contact.id })
  })

  it('returns 404 when a venue-address recipient belongs to another tenant', async () => {
    const { template } = await campaignFixture()
    const { rows: [otherVenue] } = await pool.query(
      `INSERT INTO venues (tenant_id, name, category, email)
       VALUES ($1, 'Private Venue', 'venue', 'private@test.example') RETURNING id`,
      [seed.tenantB.id],
    )
    await asUserA(request(app).post('/api/outreach/campaigns').send({
      templateId: template.id,
      recipients: [{ venueId: otherVenue.id, addressSource: 'venue' }],
    })).expect(404)
  })

  it('keeps campaign and recipient history tenant-isolated', async () => {
    const { rows: [campaign] } = await pool.query(
      `INSERT INTO outreach_campaigns
        (tenant_id, subject_snapshot, body_html_snapshot, body_text_snapshot, from_name, from_email)
       VALUES ($1, 'Private', '<p>Private</p>', 'Private', 'Other tenant', 'other@example.com') RETURNING id`,
      [seed.tenantB.id],
    )
    await pool.query(
      `INSERT INTO outreach_recipients
        (tenant_id, campaign_id, to_email, merged_subject, idempotency_key)
       VALUES ($1, $2, 'secret@example.com', 'Private', $3)`,
      [seed.tenantB.id, campaign.id, `campaign:${campaign.id}:recipient:private`],
    )
    await asUserA(request(app).get(`/api/outreach/campaigns/${campaign.id}`)).expect(404)
    const list = await asUserA(request(app).get('/api/outreach/campaigns?limit=10')).expect(200)
    expect(list.body.items).toEqual([])
  })

  it('serves the static suppression route and isolates deletes', async () => {
    const created = await asUserA(request(app).post('/api/outreach/campaigns/suppressions/list').send({ email: 'blocked@example.com' })).expect(201)
    const listed = await asUserA(request(app).get('/api/outreach/campaigns/suppressions/list?limit=10')).expect(200)
    expect(listed.body.items).toEqual([expect.objectContaining({ email: 'blocked@example.com', reason: 'manual' })])
    const { rows: [other] } = await pool.query(
      "INSERT INTO outreach_suppressions (tenant_id, email, reason) VALUES ($1, 'other@example.com', 'manual') RETURNING id",
      [seed.tenantB.id],
    )
    await asUserA(request(app).delete(`/api/outreach/campaigns/suppressions/list/${other.id}`)).expect(404)
    await asUserA(request(app).delete(`/api/outreach/campaigns/suppressions/list/${created.body.id}`)).expect(204)
  })
})
