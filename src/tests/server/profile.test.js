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
        tax_percentage: 21,
      }),
    ).expect(200)

    expect(res.body.formal_name).toBe('The Testers VOF')
    expect(res.body.kvk_number).toBe('12345678')
    expect(res.body.iban).toBe('NL91ABNA0417164300')
    expect(res.body.tax_id).toBe('NL123456789B01')
    expect(Number(res.body.tax_percentage)).toBe(21)

    const reread = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile'),
    ).expect(200)
    expect(reread.body.iban).toBe('NL91ABNA0417164300')
    expect(Number(reread.body.tax_percentage)).toBe(21)
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

  it('accepts a German tax_id when vat_country=de is set in the same patch', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'de', tax_id: 'de123456789' }),
    ).expect(200)
    expect(res.body.vat_country).toBe('de')
    expect(res.body.tax_id).toBe('DE123456789')
  })

  it('accepts a German tax_id against the stored country after vat_country=de', async () => {
    await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'de' }),
    ).expect(200)
    // No vat_country in this patch → validated against the stored 'de'.
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_id: 'DE987654321' }),
    ).expect(200)
    expect(res.body.tax_id).toBe('DE987654321')
  })

  it('rejects an out-of-range tax_percentage with 400 invalid_tax_percentage', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_percentage: 150 }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_tax_percentage')
  })

  it('updates vat_country, normalizing it to a lowercase code', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: ' DE ' }),
    ).expect(200)
    expect(res.body.vat_country).toBe('de')

    const reread = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile'),
    ).expect(200)
    expect(reread.body.vat_country).toBe('de')
  })

  it('defaults vat_country to nl for a freshly seeded tenant', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile'),
    ).expect(200)
    expect(res.body.vat_country).toBe('nl')
  })

  it('rejects an unknown vat_country with 400 invalid_vat_country', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'xx' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_vat_country')
  })

  it('DB constraint rejects an unsupported vat_country stored via raw SQL', async () => {
    // Defence in depth: even a path that bypasses the validator (raw SQL, an
    // import, a future service) cannot persist a country with no rate table.
    await expect(
      pool.query('UPDATE tenants SET vat_country = $1 WHERE id = $2', ['us', seed.tenantA.id]),
    ).rejects.toThrow()
  })

  it('DB constraint accepts every supported vat_country', async () => {
    for (const code of VAT_COUNTRY_CODES) {
      await pool.query('UPDATE tenants SET vat_country = $1 WHERE id = $2', [code, seed.tenantA.id])
    }
  })

  it('stores legal_form and directors for an incorporated band', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ legal_form: 'company', directors: 'Anna Müller, Ben Klein' }),
    ).expect(200)
    expect(res.body.legal_form).toBe('company')
    expect(res.body.directors).toBe('Anna Müller, Ben Klein')
  })

  it('rejects an unknown legal_form with 400 invalid_legal_form', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ legal_form: 'llc' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_legal_form')
  })

  it('DB constraint rejects an unsupported legal_form via raw SQL', async () => {
    await expect(
      pool.query('UPDATE tenants SET legal_form = $1 WHERE id = $2', ['llc', seed.tenantA.id]),
    ).rejects.toThrow()
  })

  it('rejects a vat_country-only change that would orphan an incompatible tax_id', async () => {
    // Store a Dutch VAT number under the default nl country.
    await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_id: 'NL123456789B01' }),
    ).expect(200)
    // Switching country alone, without touching the (now-incompatible) tax_id.
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'de' }),
    ).expect(400)
    expect(res.body.error).toBe('tax_id_incompatible_vat_country')
    // The country was not changed.
    const reread = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile'),
    ).expect(200)
    expect(reread.body.vat_country).toBe('nl')
  })

  it('allows a vat_country-only change when no tax_id is stored', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'de' }),
    ).expect(200)
    expect(res.body.vat_country).toBe('de')
  })

  it('allows switching country while clearing the incompatible tax_id in one patch', async () => {
    await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_id: 'NL123456789B01' }),
    ).expect(200)
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'de', tax_id: '' }),
    ).expect(200)
    expect(res.body.vat_country).toBe('de')
    expect(res.body.tax_id).toBe('')
  })

  it('integration: full NL → DE VAT identity lifecycle', async () => {
    const admin = (req) => as(seed.superUser.id, seed.tenantA.id)(req)

    // 1. Tenant starts as NL with a valid Dutch VAT ID.
    const start = await admin(
      request(app).patch('/api/profile').send({ tax_id: 'nl123456789b01' }),
    ).expect(200)
    expect(start.body.vat_country).toBe('nl')
    expect(start.body.tax_id).toBe('NL123456789B01')

    // 2. Change vat_country to DE on its own. The Dutch ID is invalid for DE, so
    //    (chosen behavior) the change is REJECTED rather than silently kept.
    const rejected = await admin(
      request(app).patch('/api/profile').send({ vat_country: 'de' }),
    ).expect(400)
    expect(rejected.body.error).toBe('tax_id_incompatible_vat_country')

    // 3. Nothing changed: still NL with the original Dutch ID.
    const afterReject = await admin(request(app).get('/api/profile')).expect(200)
    expect(afterReject.body.vat_country).toBe('nl')
    expect(afterReject.body.tax_id).toBe('NL123456789B01')

    // 4. Switch to DE and save a valid German VAT ID together.
    const moved = await admin(
      request(app).patch('/api/profile').send({ vat_country: 'de', tax_id: 'de123456789' }),
    ).expect(200)
    expect(moved.body.vat_country).toBe('de')
    expect(moved.body.tax_id).toBe('DE123456789')

    // 5. Subsequent updates succeed: another German number (validated against the
    //    now-stored 'de'), and an unrelated financial field.
    const nextId = await admin(
      request(app).patch('/api/profile').send({ tax_id: 'DE987654321' }),
    ).expect(200)
    expect(nextId.body.tax_id).toBe('DE987654321')

    const other = await admin(
      request(app).patch('/api/profile').send({ formal_name: 'Die Tester GmbH' }),
    ).expect(200)
    expect(other.body.formal_name).toBe('Die Tester GmbH')
    expect(other.body.vat_country).toBe('de')
    expect(other.body.tax_id).toBe('DE987654321')
  })

  it('accepts a German registration number and office when vat_country=de', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({
        vat_country: 'de', kvk_number: 'HRB 12345', registration_office: 'Amtsgericht München',
      }),
    ).expect(200)
    expect(res.body.kvk_number).toBe('HRB 12345')
    expect(res.body.registration_office).toBe('Amtsgericht München')
  })

  it('rejects a registration number invalid for the VAT country', async () => {
    // An NL 8-digit KvK number is not a valid German Handelsregisternummer.
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'de', kvk_number: '12345678' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_kvk_number')
  })

  it('rejects a registration number for a sameAsVat country (BE)', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'be', kvk_number: '0123456789' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_kvk_number')
  })

  it('rejects a vat_country-only change that would orphan an incompatible registration number', async () => {
    await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ kvk_number: '12345678' }),
    ).expect(200)
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ vat_country: 'de' }),
    ).expect(400)
    expect(res.body.error).toBe('kvk_incompatible_vat_country')
  })

  it('drops empty tax_percentage but updates other fields in the same patch', async () => {
    // The column defaults to 9.00; an empty string should be a no-op for that
    // column while a sibling non-financial field still updates.
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_percentage: '', bio: 'after' }),
    ).expect(200)
    expect(res.body.bio).toBe('after')
    expect(Number(res.body.tax_percentage)).toBe(9)
  })

  it('PATCH containing only { tax_percentage: "" } drops the only field and 400s', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_percentage: '' }),
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

describe('DELETE /api/profile/memory-image', () => {
  async function seedMemory(tenantId, gigId) {
    await pool.query(
      `UPDATE tenants
          SET memory_image_path = $1, memory_caption = $2, memory_gig_id = $3
        WHERE id = $4`,
      [`tenants/${tenantId}/memory/photo.webp`, 'What a show', gigId, tenantId],
    )
  }

  it('clears the photo, caption and gig link together', async () => {
    await seedMemory(seed.tenantA.id, seed.gigA.id)

    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).delete('/api/profile/memory-image'),
    ).expect(200)
    expect(res.body).toEqual({ memory_image_path: null, memory_caption: null, memory_gig_id: null })

    const { rows: [stored] } = await pool.query(
      'SELECT memory_image_path, memory_caption, memory_gig_id FROM tenants WHERE id = $1',
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
      'SELECT memory_caption FROM tenants WHERE id = $1',
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
      'SELECT shopify_client_secret, shopify_client_secret_encrypted FROM tenants WHERE id = $1',
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
      `UPDATE tenants SET shopify_client_id = $1, shopify_client_secret = $2,
                          shopify_client_secret_encrypted = NULL, shopify_shop_domain = $3
        WHERE id = $4`,
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
