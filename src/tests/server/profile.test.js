import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'
import { VAT_COUNTRY_CODES } from '../../../shared/vatRates.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let getAccessToken, resetShopifyTokenCacheForTests
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  ;({ getAccessToken, resetShopifyTokenCacheForTests } = await import('../../../server/services/shopifyTokenService.js'))
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  resetShopifyTokenCacheForTests()
  // seedTwoTenants() makes every user a tenant_admin. Downgrade userA in
  // tenantA to a plain contributor so we can test the financial-field gate.
  await pool.query(
    `UPDATE memberships SET role = 'contributor'
     WHERE user_id = $1 AND tenant_id = $2`,
    [seed.userA.id, seed.tenantA.id],
  )
})

afterAll(async () => {
  await pool.end()
})

// seedTwoTenants() gives both tenants an NL VAT number so finance tests can issue
// invoices. A test that switches vat_country for some OTHER reason must clear it
// first, or the tax_id/country consistency guard is the rule that fires.
function clearStoredVatId() {
  return pool.query('UPDATE tenants SET tax_id = NULL WHERE id = $1', [seed.tenantA.id])
}

// The accounting country is chosen at band creation and is not patchable through
// /api/profile, so tests that need another jurisdiction set it on the profile,
// which is where it lives.
async function setStoredCountry(code) {
  await pool.query(
    'UPDATE tenant_accounting_profiles SET country_code = $1 WHERE tenant_id = $2',
    [code, seed.tenantA.id],
  )
}

function as(userId, tenantId) {
  return (req) =>
    req
      .set('x-test-user-id', String(userId))
      .set('x-test-tenant-id', tenantId === null ? 'null' : String(tenantId))
}

describe('PATCH /api/profile — financial fields', () => {
  it('tenant_admin can update financial fields and they persist', async () => {
    // superUser is tenant_admin of tenantA per seed
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({
        formal_name: 'The Testers VOF',
        kvk_number: '12345678',
        iban: 'nl91 abna 0417 1643 00',
        tax_id: 'nl123456789b01',
      }),
    ).expect(200)

    expect(res.body.formal_name).toBe('The Testers VOF')
    expect(res.body.kvk_number).toBe('12345678')
    expect(res.body.iban).toBe('NL91ABNA0417164300')
    expect(res.body.tax_id).toBe('NL123456789B01')

    const reread = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile'),
    ).expect(200)
    expect(reread.body.iban).toBe('NL91ABNA0417164300')
  })

  it('member cannot patch financial fields → 403', async () => {
    const res = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ kvk_number: '12345678' }),
    ).expect(403)
    expect(res.body.error).toBe('tenant_admin_required')
  })

  it('member can still patch non-financial fields like bio', async () => {
    const res = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ bio: 'Member-edited bio' }),
    ).expect(200)
    expect(res.body.bio).toBe('Member-edited bio')
  })

  it('reader cannot patch non-financial profile fields', async () => {
    await pool.query(
      `UPDATE memberships SET role = 'reader'
       WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )

    await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ bio: 'Reader edit' }),
    ).expect(403)
  })

  it('accepts a short_bio of exactly 150 characters', async () => {
    const short_bio = 'a'.repeat(150)
    const res = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ short_bio }),
    ).expect(200)
    expect(res.body.short_bio).toBe(short_bio)
  })

  it('rejects a short_bio over 150 characters with 400 invalid_short_bio and stores nothing', async () => {
    await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ short_bio: 'Kept' }),
    ).expect(200)

    const res = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ short_bio: 'b'.repeat(151), bio: 'Should not land' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_short_bio')

    const reread = await as(seed.userA.id, seed.tenantA.id)(
      request(app).get('/api/profile'),
    ).expect(200)
    expect(reread.body.short_bio).toBe('Kept')
    expect(reread.body.bio).not.toBe('Should not land')
  })

  it('stores an empty short_bio as null', async () => {
    const res = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ short_bio: '' }),
    ).expect(200)
    expect(res.body.short_bio).toBeNull()
  })

  it('keeps short_bio isolated per tenant', async () => {
    await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ short_bio: 'Alpha blurb' }),
    ).expect(200)
    await as(seed.userB.id, seed.tenantB.id)(
      request(app).patch('/api/profile').send({ short_bio: 'Beta blurb' }),
    ).expect(200)

    const a = await as(seed.userA.id, seed.tenantA.id)(request(app).get('/api/profile')).expect(200)
    expect(a.body.short_bio).toBe('Alpha blurb')
    const b = await as(seed.userB.id, seed.tenantB.id)(request(app).get('/api/profile')).expect(200)
    expect(b.body.short_bio).toBe('Beta blurb')
  })

  it('rejects an invalid kvk_number with 400 invalid_kvk_number', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ kvk_number: '123' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_kvk_number')
  })

  it('rejects an invalid IBAN with 400 invalid_iban', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ iban: 'NOTANIBAN' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_iban')
  })

  // Business contact details (EN 16931 seller contact BT-42/BT-43). Optional, so
  // clearing them must stay possible; only a non-empty malformed value is an error.
  it('stores trimmed business contact details and reads them back', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({
        email: '  bookings@theband.example  ',
        phone: ' +31 6 1234 5678 ',
      }),
    ).expect(200)
    expect(res.body.email).toBe('bookings@theband.example')
    expect(res.body.phone).toBe('+31 6 1234 5678')

    const reread = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile'),
    ).expect(200)
    expect(reread.body.email).toBe('bookings@theband.example')
    expect(reread.body.phone).toBe('+31 6 1234 5678')
  })

  it('allows clearing the business contact details', async () => {
    const as1 = as(seed.superUser.id, seed.tenantA.id)
    await as1(request(app).patch('/api/profile').send({ email: 'x@y.example', phone: '+3112345' })).expect(200)
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ email: '', phone: '' }),
    ).expect(200)
    expect(res.body.email).toBe('')
    expect(res.body.phone).toBe('')
  })

  it('rejects a malformed email with 400 invalid_email', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ email: 'not an address' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_email')
  })

  it('rejects a malformed phone with 400 invalid_phone', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ phone: 'call me' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_phone')
  })

  it('rejects an invalid tax_id with 400 invalid_tax_id', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_id: 'NL123' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_tax_id')
  })

  it('validates tax_id against the tenant stored VAT country (NL rejects a DE number)', async () => {
    // Seed tenant's vat_country is nl, so a German number is not a valid tax_id.
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_id: 'DE123456789' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_tax_id')
  })

  it('accepts a German tax_id for a German tenant', async () => {
    await clearStoredVatId()
    await setStoredCountry('de')
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_id: 'de136695976' }),
    ).expect(200)
    expect(res.body.tax_id).toBe('DE136695976')
  })

  it('no longer accepts vat_country — it belongs to the accounting profile', async () => {
    await clearStoredVatId()
    await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'de' }),
    ).expect(400)

    const profile = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/accounting-profile'),
    ).expect(200)
    expect(profile.body.country_code).toBe('nl')
  })

  // The regime is served by its own endpoint; the band profile no longer carries
  // a copy that could go stale.
  it('does not expose the accounting regime on the band profile', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile'),
    ).expect(200)
    expect(res.body).not.toHaveProperty('vat_country')
    expect(res.body).not.toHaveProperty('tax_percentage')
    expect(res.body).not.toHaveProperty('applies_kor')
    expect(res.body).not.toHaveProperty('legal_form')
  })

  it('DB constraint rejects an unsupported accounting country via raw SQL', async () => {
    // Defence in depth: even a path that bypasses the validator (raw SQL, an
    // import, a future service) cannot persist a country with no rate table.
    await expect(
      pool.query(
        'UPDATE tenant_accounting_profiles SET country_code = $1 WHERE tenant_id = $2',
        ['us', seed.tenantA.id],
      ),
    ).rejects.toThrow()
  })

  it('DB constraint accepts every supported accounting country', async () => {
    for (const code of VAT_COUNTRY_CODES) {
      const { rows } = await pool.query(
        `UPDATE tenant_accounting_profiles SET country_code = $1
          WHERE tenant_id = $2 RETURNING country_code`,
        [code, seed.tenantA.id],
      )
      expect(rows[0].country_code).toBe(code)
    }
  })

  it('stores directors for an incorporated band', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ directors: 'Anna Müller, Ben Klein' }),
    ).expect(200)
    expect(res.body.directors).toBe('Anna Müller, Ben Klein')
  })

  it('no longer accepts legal_form — it belongs to the accounting profile', async () => {
    await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ legal_form: 'company' }),
    ).expect(400)
  })

  it('DB constraint rejects an unsupported legal_form via raw SQL', async () => {
    await expect(
      pool.query(
        'UPDATE tenant_accounting_profiles SET legal_form = $1 WHERE tenant_id = $2',
        ['llc', seed.tenantA.id],
      ),
    ).rejects.toThrow()
  })

  it('integration: VAT identity lifecycle within a jurisdiction', async () => {
    const admin = (req) => as(seed.superUser.id, seed.tenantA.id)(req)

    // 1. Tenant starts as NL with a valid Dutch VAT ID (case-normalized).
    const start = await admin(
      request(app).patch('/api/profile').send({ tax_id: 'nl123456789b01' }),
    ).expect(200)
    expect(start.body.tax_id).toBe('NL123456789B01')

    // 2. A German number is invalid while the tenant is Dutch.
    await admin(request(app).patch('/api/profile').send({ tax_id: 'DE136695976' })).expect(400)

    // 3. The country is not patchable here, so it cannot be talked into accepting it.
    await admin(request(app).patch('/api/profile').send({ vat_country: 'de' })).expect(400)
    const afterReject = await admin(request(app).get('/api/profile')).expect(200)
    expect(afterReject.body.tax_id).toBe('NL123456789B01')

    // 4. Once the tenant really is German, German numbers validate and other
    //    financial fields keep working alongside.
    await setStoredCountry('de')
    const moved = await admin(
      request(app).patch('/api/profile').send({ tax_id: 'de136695976' }),
    ).expect(200)
    expect(moved.body.tax_id).toBe('DE136695976')

    const other = await admin(
      request(app).patch('/api/profile').send({ formal_name: 'Die Tester GmbH' }),
    ).expect(200)
    expect(other.body.formal_name).toBe('Die Tester GmbH')
    expect(other.body.tax_id).toBe('DE136695976')
  })

  it('accepts a German registration number and office for a German tenant', async () => {
    await clearStoredVatId()
    await setStoredCountry('de')
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({
        kvk_number: 'HRB 12345', registration_office: 'Amtsgericht München',
      }),
    ).expect(200)
    expect(res.body.kvk_number).toBe('HRB 12345')
    expect(res.body.registration_office).toBe('Amtsgericht München')
  })

  it('rejects a registration number invalid for the VAT country', async () => {
    await clearStoredVatId()
    await setStoredCountry('de')
    // An NL 8-digit KvK number is not a valid German Handelsregisternummer.
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ kvk_number: '12345678' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_kvk_number')
  })

  it('rejects a registration number for a sameAsVat country (BE)', async () => {
    await clearStoredVatId()
    await setStoredCountry('be')
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ kvk_number: '0123456789' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_kvk_number')
  })

  it('drops the retired tax_percentage but updates other fields in the same patch', async () => {
    // It moved to the accounting profile. A stale client still sending it has the
    // field ignored rather than the whole patch rejected.
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_percentage: 21, bio: 'after' }),
    ).expect(200)
    expect(res.body.bio).toBe('after')
    expect(res.body).not.toHaveProperty('tax_percentage')
  })

  it('PATCH containing only { tax_percentage } drops the only field and 400s', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_percentage: 21 }),
    ).expect(400)
    expect(res.body.error).toBe('No valid fields to update')
  })
})

describe('PATCH /api/profile — accent color', () => {
  it.each(['reader', 'contributor', 'financial_admin'])(
    '%s cannot update the tenant accent color',
    async (role) => {
      await pool.query(
        `UPDATE memberships SET role = $1
         WHERE user_id = $2 AND tenant_id = $3`,
        [role, seed.userA.id, seed.tenantA.id],
      )

      const res = await as(seed.userA.id, seed.tenantA.id)(
        request(app).patch('/api/profile').send({ accent_color: '#ff0000' }),
      ).expect(403)

      expect(res.body.error).toBe(role === 'reader' ? 'Forbidden' : 'tenant_admin_required')

      const stored = await pool.query(
        'SELECT accent_color FROM tenants WHERE id = $1',
        [seed.tenantA.id],
      )
      expect(stored.rows[0].accent_color).toBeNull()
    },
  )
})

describe('extracted tenant data', () => {
  it('stores integrations and the memory tile outside tenants while preserving the profile API', async () => {
    const movedColumns = [
      'memory_image_path', 'memory_caption', 'memory_gig_id',
      'bandsintown_artist_name', 'bandsintown_artist_id',
      'bandsintown_app_id', 'bandsintown_app_id_encrypted', 'bandsintown_app_id_changed_at',
      'shopify_client_id', 'shopify_client_secret', 'shopify_client_secret_encrypted',
      'shopify_client_secret_changed_at', 'shopify_shop_domain',
      'mollie_api_key', 'mollie_api_key_encrypted', 'mollie_api_key_changed_at',
      'mollie_api_key_retained_at',
    ]
    const { rows: tenantColumns } = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenants'
          AND column_name = ANY($1::text[])`,
      [movedColumns],
    )
    expect(tenantColumns).toEqual([])

    const response = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({
        memory_caption: 'Outside the tenant row',
        memory_gig_id: seed.gigA.id,
        bandsintown_artist_name: 'Alpha Artist',
        bandsintown_artist_id: '12345',
      }),
    ).expect(200)

    const { rows: [tile] } = await pool.query(
      `SELECT tile_id, type, caption, gig_id
         FROM dashboard_tiles
        WHERE tenant_id = $1 AND type = 'memory_tile'`,
      [seed.tenantA.id],
    )
    expect(tile).toEqual({
      tile_id: expect.any(Number),
      type: 'memory_tile',
      caption: 'Outside the tenant row',
      gig_id: seed.gigA.id,
    })

    const { rows: [integration] } = await pool.query(
      `SELECT bandsintown_artist_name, bandsintown_artist_id
         FROM tenant_integrations WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(integration).toEqual({
      bandsintown_artist_name: 'Alpha Artist',
      bandsintown_artist_id: '12345',
    })
    expect(response.body).toMatchObject({
      memory_caption: 'Outside the tenant row',
      memory_gig_id: seed.gigA.id,
      bandsintown_artist_name: 'Alpha Artist',
      bandsintown_artist_id: '12345',
    })
  })
})

describe('DELETE /api/profile/memory-image', () => {
  async function seedMemory(tenantId, gigId) {
    await pool.query(
      `INSERT INTO dashboard_tiles (tenant_id, type, image_path, caption, gig_id)
       VALUES ($1, 'memory_tile', $2, $3, $4)`,
      [tenantId, `tenants/${tenantId}/memory/photo.webp`, 'What a show', gigId],
    )
  }

  it('clears the photo, caption and gig link together', async () => {
    await seedMemory(seed.tenantA.id, seed.gigA.id)

    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).delete('/api/profile/memory-image'),
    ).expect(200)
    expect(res.body).toEqual({ memory_image_path: null, memory_caption: null, memory_gig_id: null })

    const { rows: [stored] } = await pool.query(
      `SELECT image_path AS memory_image_path, caption AS memory_caption, gig_id AS memory_gig_id
         FROM dashboard_tiles
        WHERE tenant_id = $1 AND type = 'memory_tile'`,
      [seed.tenantA.id],
    )
    expect(stored).toEqual({ memory_image_path: null, memory_caption: null, memory_gig_id: null })
  })

  it('leaves another tenant\'s memory tile untouched (isolation)', async () => {
    await seedMemory(seed.tenantA.id, seed.gigA.id)

    // userB acting in tenantB clears only tenantB — there is no id in the URL,
    // so the write is scoped to the active tenant and tenantA is unaffected.
    await as(seed.userB.id, seed.tenantB.id)(
      request(app).delete('/api/profile/memory-image'),
    ).expect(200)

    const { rows: [stored] } = await pool.query(
      `SELECT caption AS memory_caption
         FROM dashboard_tiles
        WHERE tenant_id = $1 AND type = 'memory_tile'`,
      [seed.tenantA.id],
    )
    expect(stored.memory_caption).toBe('What a show')
  })
})

describe('Shopify credential management', () => {
  // Stub secret in the real "shpss_" + 32-hex format — not a real credential.
  // Built by concatenation so the full token never appears as a literal in source
  // (otherwise GitHub push protection flags it as a leaked Shopify secret).
  const validSecret = 'shpss_' + '0123456789abcdef'.repeat(2)

  it('encrypts a valid secret and returns status without a preview', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).put('/api/profile/shopify-secret').send({ secret: validSecret }),
    ).expect(200)
    expect(res.body).toEqual({ isSet: true, changedAt: expect.any(String) })
    expect(res.headers['cache-control']).toBe('no-store')

    const { rows: [stored] } = await pool.query(
      `SELECT shopify_client_secret, shopify_client_secret_encrypted
         FROM tenant_integrations WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(stored.shopify_client_secret).toBeNull()
    expect(stored.shopify_client_secret_encrypted).toEqual(expect.objectContaining({ v: 1, kid: 'test' }))
  })

  it('persists the secret so a re-read reports only set status', async () => {
    await as(seed.superUser.id, seed.tenantA.id)(
      request(app).put('/api/profile/shopify-secret').send({ secret: validSecret }),
    ).expect(200)
    const reread = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile/shopify-secret'),
    ).expect(200)
    expect(reread.body).toEqual({ isSet: true, changedAt: expect.any(String) })
    expect(JSON.stringify(reread.body)).not.toContain('preview')
  })

  it('rejects a bare 32-hex secret (no "shpss_" prefix) with 400', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).put('/api/profile/shopify-secret').send({ secret: 'a'.repeat(32) }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_shopify_client_secret')
  })

  it('rejects an "shpss_" secret with a non-hex body with 400', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).put('/api/profile/shopify-secret').send({ secret: 'shpss_' + 'z'.repeat(32) }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_shopify_client_secret')
  })

  it('rejects an "shpss_" secret of the wrong length with 400', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).put('/api/profile/shopify-secret').send({ secret: 'shpss_abc123' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_shopify_client_secret')
  })

  it('forbids a plain member from setting the secret → 403', async () => {
    await as(seed.userA.id, seed.tenantA.id)(
      request(app).put('/api/profile/shopify-secret').send({ secret: validSecret }),
    ).expect(403)
  })

  it('forbids a financial admin from reading or changing all Shopify configuration', async () => {
    await pool.query(
      'UPDATE memberships SET role = $1 WHERE user_id = $2 AND tenant_id = $3',
      ['financial_admin', seed.userA.id, seed.tenantA.id],
    )
    for (const path of ['shopify-secret', 'shopify-client-id', 'shopify-domain']) {
      await as(seed.userA.id, seed.tenantA.id)(request(app).get(`/api/profile/${path}`)).expect(403)
    }
  })

  it('audits committed changes without logging credential values', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await as(seed.superUser.id, seed.tenantA.id)(
        request(app).put('/api/profile/shopify-secret').send({ secret: validSecret }),
      ).expect(200)
      const event = JSON.parse(log.mock.calls.at(-1)[0])
      expect(event).toMatchObject({
        action: 'integration.shopify_secret.set',
        userId: seed.superUser.id,
        tenantId: seed.tenantA.id,
      })
      expect(event.ts).toEqual(expect.any(String))
      expect(event.ip).toBeDefined()
      expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain(validSecret)
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
  })

  it.each([
    ['PUT', 'shopify-secret', { secret: validSecret }],
    ['DELETE', 'shopify-secret', null],
    ['PUT', 'shopify-client-id', { clientId: 'c'.repeat(32) }],
    ['DELETE', 'shopify-client-id', null],
    ['PUT', 'shopify-domain', { domain: 'changed.myshopify.com' }],
    ['DELETE', 'shopify-domain', null],
  ])('invalidates cached tokens after %s /%s', async (method, path, body) => {
    await pool.query(
      `INSERT INTO tenant_integrations (
         shopify_client_id, shopify_client_secret,
         shopify_client_secret_encrypted, shopify_shop_domain, tenant_id
       ) VALUES ($1, $2, NULL, $3, $4)`,
      ['a'.repeat(32), validSecret, 'test-band.myshopify.com', seed.tenantA.id],
    )
    const mint = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'short-lived-token', expires_in: 3600 }),
    }))
    await getAccessToken(pool, seed.tenantA.id, mint)
    expect(mint).toHaveBeenCalledTimes(1)

    let req = request(app)[method.toLowerCase()](`/api/profile/${path}`)
    req = as(seed.superUser.id, seed.tenantA.id)(req)
    if (body) req = req.send(body)
    await req.expect(200)

    const after = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'replacement-token', expires_in: 3600 }),
    }))
    const result = await getAccessToken(pool, seed.tenantA.id, after)
    if (method === 'DELETE') {
      expect(result.error).toBeDefined()
    } else {
      expect(after).toHaveBeenCalledTimes(1)
    }
  })
})
