import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

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
  // seedTwoTenants() makes every user a tenant_admin. Downgrade userA in
  // tenantA to a plain member so we can test the financial-field gate.
  await pool.query(
    `UPDATE memberships SET role = 'member'
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

  it('rejects an out-of-range tax_percentage with 400 invalid_tax_percentage', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch('/api/profile').send({ tax_percentage: 150 }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_tax_percentage')
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

describe('PUT /api/profile/shopify-secret — app secret validation & masking', () => {
  // Stub secret in the real "shpss_" + 32-hex format — not a real credential.
  // Built by concatenation so the full token never appears as a literal in source
  // (otherwise GitHub push protection flags it as a leaked Shopify secret).
  const validSecret = 'shpss_' + '0123456789abcdef'.repeat(2)

  it('accepts an "shpss_"-prefixed 32-hex secret and returns a masked preview', async () => {
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).put('/api/profile/shopify-secret').send({ secret: validSecret }),
    ).expect(200)
    expect(res.body.isSet).toBe(true)
    // Preview keeps the "shpss_" prefix and last 4 chars visible, masks the rest,
    // and never echoes the raw secret.
    expect(res.body.preview).toMatch(/^shpss_•+cdef$/)
    expect(res.body.preview).not.toContain('0123456789')
  })

  it('persists the secret so a re-read reports it set with the same mask', async () => {
    await as(seed.superUser.id, seed.tenantA.id)(
      request(app).put('/api/profile/shopify-secret').send({ secret: validSecret }),
    ).expect(200)
    const reread = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).get('/api/profile/shopify-secret'),
    ).expect(200)
    expect(reread.body.isSet).toBe(true)
    expect(reread.body.preview).toMatch(/^shpss_•+cdef$/)
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
})
