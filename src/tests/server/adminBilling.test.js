import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { validateEntitlements, FEATURE_KEYS, LIMIT_KEYS } from '../../../shared/entitlements.js'
import { DEFAULT_PLANS, seedDefaultPlans } from '../../../server/db/defaultPlans.js'

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
  // Plans are a global catalog (not wiped by truncateAll); restore the
  // canonical default tiers so cases are independent.
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
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

const asUserA = (req) => as(seed.userA.id, seed.tenantA.id)(req)
const asSuper = (req) => as(seed.superUser.id, seed.tenantA.id)(req)

// A valid, complete entitlements payload for create/update tests.
function completeEntitlements() {
  return {
    features: {
      finance: true,
      integrations: true,
      customization: true,
      song_files: true,
      chordpro: true,
      public_promotion: false,
    },
    limits: { storage_mb: 250, members: 10, bands: 2 },
  }
}

function validPlanBody(overrides = {}) {
  return {
    slug: 'platinum',
    name: 'Platinum',
    monthly_price_cents: 1500,
    yearly_price_cents: 15000,
    entitlements: completeEntitlements(),
    sort_order: 4,
    ...overrides,
  }
}

async function fetchPlanRow(slug) {
  const { rows } = await pool.query('SELECT * FROM subscription_plans WHERE slug = $1', [slug])
  return rows[0] ?? null
}

describe('shared/entitlements validateEntitlements', () => {
  it('accepts a complete entitlements object', () => {
    expect(validateEntitlements(completeEntitlements())).toEqual([])
  })

  it('accepts null limits as unlimited', () => {
    const e = completeEntitlements()
    e.limits.members = null
    expect(validateEntitlements(e)).toEqual([])
  })

  it('rejects a missing feature key', () => {
    const e = completeEntitlements()
    delete e.features.finance
    expect(validateEntitlements(e)).not.toEqual([])
  })

  it('rejects a missing limit key', () => {
    const e = completeEntitlements()
    delete e.limits.storage_mb
    expect(validateEntitlements(e)).not.toEqual([])
  })

  it('rejects unknown keys at every level', () => {
    expect(validateEntitlements({ ...completeEntitlements(), extra: {} })).not.toEqual([])
    const e1 = completeEntitlements()
    e1.features.teleport = true
    expect(validateEntitlements(e1)).not.toEqual([])
    const e2 = completeEntitlements()
    e2.limits.gigs = 3
    expect(validateEntitlements(e2)).not.toEqual([])
  })

  it('rejects invalid value types', () => {
    const e1 = completeEntitlements()
    e1.features.finance = 'yes'
    expect(validateEntitlements(e1)).not.toEqual([])
    const e2 = completeEntitlements()
    e2.limits.members = -1
    expect(validateEntitlements(e2)).not.toEqual([])
    const e3 = completeEntitlements()
    e3.limits.members = 2.5
    expect(validateEntitlements(e3)).not.toEqual([])
    expect(validateEntitlements(null)).not.toEqual([])
    expect(validateEntitlements([])).not.toEqual([])
  })
})

describe('seeded default plans', () => {
  it('seeds bronze, silver, and gold in sort order', async () => {
    const res = await asSuper(request(app).get('/api/admin/plans')).expect(200)
    expect(res.body.map((p) => p.slug)).toEqual(['bronze', 'silver', 'gold'])
  })

  it('bronze is the active, free fallback plan', async () => {
    const res = await asSuper(request(app).get('/api/admin/plans')).expect(200)
    const bronze = res.body.find((p) => p.slug === 'bronze')
    expect(bronze.is_fallback).toBe(true)
    expect(bronze.is_active).toBe(true)
    expect(bronze.monthly_price_cents).toBe(0)
    expect(bronze.yearly_price_cents).toBe(0)
    expect(bronze.entitlements.limits).toEqual({ storage_mb: 50, members: 5, bands: 1 })
    for (const key of FEATURE_KEYS) expect(bronze.entitlements.features[key]).toBe(false)
  })

  it('silver and gold are unpriced (NULL = unavailable) until an admin sets prices', async () => {
    const res = await asSuper(request(app).get('/api/admin/plans')).expect(200)
    for (const slug of ['silver', 'gold']) {
      const plan = res.body.find((p) => p.slug === slug)
      expect(plan.is_fallback).toBe(false)
      expect(plan.monthly_price_cents).toBeNull()
      expect(plan.yearly_price_cents).toBeNull()
    }
  })

  it('every seeded plan carries complete, valid entitlements', async () => {
    const res = await asSuper(request(app).get('/api/admin/plans')).expect(200)
    expect(res.body).toHaveLength(DEFAULT_PLANS.length)
    for (const plan of res.body) {
      expect(validateEntitlements(plan.entitlements)).toEqual([])
    }
  })

  it('gold has unlimited members and bands, silver caps bands at 3', async () => {
    const res = await asSuper(request(app).get('/api/admin/plans')).expect(200)
    const silver = res.body.find((p) => p.slug === 'silver')
    const gold = res.body.find((p) => p.slug === 'gold')
    expect(silver.entitlements.features.finance).toBe(false)
    expect(silver.entitlements.limits).toEqual({ storage_mb: 150, members: null, bands: 3 })
    for (const key of FEATURE_KEYS) expect(gold.entitlements.features[key]).toBe(true)
    expect(gold.entitlements.limits).toEqual({ storage_mb: 500, members: null, bands: null })
  })
})

describe('authorization', () => {
  it('rejects non-super-admin users on every plan endpoint', async () => {
    await asUserA(request(app).get('/api/admin/plans')).expect(403)
    await asUserA(request(app).post('/api/admin/plans').send(validPlanBody())).expect(403)
    await asUserA(request(app).patch('/api/admin/plans/1').send({ name: 'X' })).expect(403)
    await asUserA(request(app).delete('/api/admin/plans/1')).expect(403)
  })
})

describe('POST /api/admin/plans', () => {
  it('creates a paid plan', async () => {
    const res = await asSuper(request(app).post('/api/admin/plans').send(validPlanBody())).expect(201)
    expect(res.body.slug).toBe('platinum')
    expect(res.body.monthly_price_cents).toBe(1500)
    expect(res.body.is_fallback).toBe(false)
    expect(res.body.is_active).toBe(true)
    expect(res.body.entitlements).toEqual(completeEntitlements())
    expect(await fetchPlanRow('platinum')).not.toBeNull()
  })

  it('creates an unpriced plan (NULL prices allowed)', async () => {
    const res = await asSuper(
      request(app)
        .post('/api/admin/plans')
        .send(validPlanBody({ monthly_price_cents: null, yearly_price_cents: null })),
    ).expect(201)
    expect(res.body.monthly_price_cents).toBeNull()
    expect(res.body.yearly_price_cents).toBeNull()
  })

  it('rejects an invalid slug', async () => {
    await asSuper(request(app).post('/api/admin/plans').send(validPlanBody({ slug: 'Platinum!' }))).expect(400)
    await asSuper(request(app).post('/api/admin/plans').send(validPlanBody({ slug: '' }))).expect(400)
  })

  it('rejects a missing name', async () => {
    await asSuper(request(app).post('/api/admin/plans').send(validPlanBody({ name: '' }))).expect(400)
  })

  it('409s on a duplicate slug', async () => {
    await asSuper(request(app).post('/api/admin/plans').send(validPlanBody({ slug: 'gold' }))).expect(409)
  })

  it('rejects a price of 0 — only the fallback plan may be free', async () => {
    const res = await asSuper(
      request(app).post('/api/admin/plans').send(validPlanBody({ monthly_price_cents: 0 })),
    ).expect(400)
    expect(res.body.error).toMatch(/fallback/i)
  })

  it('rejects negative and non-integer prices', async () => {
    await asSuper(
      request(app).post('/api/admin/plans').send(validPlanBody({ monthly_price_cents: -100 })),
    ).expect(400)
    await asSuper(
      request(app).post('/api/admin/plans').send(validPlanBody({ yearly_price_cents: 99.5 })),
    ).expect(400)
  })

  it('rejects incomplete or invalid entitlements', async () => {
    const incomplete = completeEntitlements()
    delete incomplete.features.finance
    await asSuper(
      request(app).post('/api/admin/plans').send(validPlanBody({ entitlements: incomplete })),
    ).expect(400)
    await asSuper(
      request(app).post('/api/admin/plans').send(validPlanBody({ entitlements: undefined })),
    ).expect(400)
  })

  it('rejects creating a plan as fallback — the fallback designation is fixed', async () => {
    await asSuper(
      request(app).post('/api/admin/plans').send(validPlanBody({ is_fallback: true })),
    ).expect(400)
  })
})

describe('PATCH /api/admin/plans/:id', () => {
  it('sets prices on an unpriced plan (making it available)', async () => {
    const silver = await fetchPlanRow('silver')
    const res = await asSuper(
      request(app)
        .patch(`/api/admin/plans/${silver.id}`)
        .send({ monthly_price_cents: 999, yearly_price_cents: 9990 }),
    ).expect(200)
    expect(res.body.monthly_price_cents).toBe(999)
    expect(res.body.yearly_price_cents).toBe(9990)
  })

  it('can make an interval unavailable again (price back to NULL)', async () => {
    const silver = await fetchPlanRow('silver')
    await asSuper(
      request(app).patch(`/api/admin/plans/${silver.id}`).send({ monthly_price_cents: 500 }),
    ).expect(200)
    const res = await asSuper(
      request(app).patch(`/api/admin/plans/${silver.id}`).send({ monthly_price_cents: null }),
    ).expect(200)
    expect(res.body.monthly_price_cents).toBeNull()
  })

  it('renames and deactivates a non-fallback plan', async () => {
    const gold = await fetchPlanRow('gold')
    const res = await asSuper(
      request(app)
        .patch(`/api/admin/plans/${gold.id}`)
        .send({ name: 'Gold Deluxe', is_active: false, sort_order: 9 }),
    ).expect(200)
    expect(res.body.name).toBe('Gold Deluxe')
    expect(res.body.is_active).toBe(false)
    expect(res.body.sort_order).toBe(9)
  })

  it('replaces entitlements when the replacement is complete', async () => {
    const gold = await fetchPlanRow('gold')
    const entitlements = completeEntitlements()
    const res = await asSuper(
      request(app).patch(`/api/admin/plans/${gold.id}`).send({ entitlements }),
    ).expect(200)
    expect(res.body.entitlements).toEqual(entitlements)
  })

  it('rejects incomplete entitlements on update', async () => {
    const gold = await fetchPlanRow('gold')
    const incomplete = completeEntitlements()
    delete incomplete.limits.bands
    await asSuper(
      request(app).patch(`/api/admin/plans/${gold.id}`).send({ entitlements: incomplete }),
    ).expect(400)
  })

  it('rejects a price of 0 on a non-fallback plan', async () => {
    const silver = await fetchPlanRow('silver')
    await asSuper(
      request(app).patch(`/api/admin/plans/${silver.id}`).send({ monthly_price_cents: 0 }),
    ).expect(400)
  })

  it('protects the fallback plan: no rename, no slug change, no deactivation', async () => {
    const bronze = await fetchPlanRow('bronze')
    await asSuper(
      request(app).patch(`/api/admin/plans/${bronze.id}`).send({ name: 'Copper' }),
    ).expect(400)
    await asSuper(
      request(app).patch(`/api/admin/plans/${bronze.id}`).send({ slug: 'copper' }),
    ).expect(400)
    await asSuper(
      request(app).patch(`/api/admin/plans/${bronze.id}`).send({ is_active: false }),
    ).expect(400)
  })

  it('protects the fallback plan: prices must stay 0', async () => {
    const bronze = await fetchPlanRow('bronze')
    await asSuper(
      request(app).patch(`/api/admin/plans/${bronze.id}`).send({ monthly_price_cents: 500 }),
    ).expect(400)
    await asSuper(
      request(app).patch(`/api/admin/plans/${bronze.id}`).send({ yearly_price_cents: null }),
    ).expect(400)
    // Explicit 0 is a no-op and allowed.
    await asSuper(
      request(app).patch(`/api/admin/plans/${bronze.id}`).send({ monthly_price_cents: 0 }),
    ).expect(200)
  })

  it('allows editing fallback entitlements as long as they stay complete', async () => {
    const bronze = await fetchPlanRow('bronze')
    const entitlements = completeEntitlements()
    const res = await asSuper(
      request(app).patch(`/api/admin/plans/${bronze.id}`).send({ entitlements }),
    ).expect(200)
    expect(res.body.entitlements).toEqual(entitlements)
  })

  it('rejects changing the fallback designation in either direction', async () => {
    const bronze = await fetchPlanRow('bronze')
    const silver = await fetchPlanRow('silver')
    await asSuper(
      request(app).patch(`/api/admin/plans/${bronze.id}`).send({ is_fallback: false }),
    ).expect(400)
    await asSuper(
      request(app).patch(`/api/admin/plans/${silver.id}`).send({ is_fallback: true }),
    ).expect(400)
  })

  it('404s on an unknown plan id', async () => {
    await asSuper(request(app).patch('/api/admin/plans/999999').send({ name: 'X' })).expect(404)
  })
})

describe('DELETE /api/admin/plans/:id', () => {
  it('deletes a non-fallback plan', async () => {
    const created = await asSuper(request(app).post('/api/admin/plans').send(validPlanBody())).expect(201)
    await asSuper(request(app).delete(`/api/admin/plans/${created.body.id}`)).expect(204)
    expect(await fetchPlanRow('platinum')).toBeNull()
  })

  it('refuses to delete the fallback plan', async () => {
    const bronze = await fetchPlanRow('bronze')
    const res = await asSuper(request(app).delete(`/api/admin/plans/${bronze.id}`)).expect(400)
    expect(res.body.error).toMatch(/fallback/i)
    expect(await fetchPlanRow('bronze')).not.toBeNull()
  })

  it('404s on an unknown plan id', async () => {
    await asSuper(request(app).delete('/api/admin/plans/999999')).expect(404)
  })
})

describe('database backstops', () => {
  it('rejects a second fallback plan at the DB level', async () => {
    await expect(
      pool.query(
        `INSERT INTO subscription_plans (slug, name, monthly_price_cents, yearly_price_cents, is_fallback)
         VALUES ('copper', 'Copper', 0, 0, TRUE)`,
      ),
    ).rejects.toThrow()
  })

  it('rejects a non-free or inactive fallback at the DB level', async () => {
    await expect(
      pool.query(`UPDATE subscription_plans SET monthly_price_cents = 100 WHERE is_fallback`),
    ).rejects.toThrow()
    await expect(
      pool.query(`UPDATE subscription_plans SET is_active = FALSE WHERE is_fallback`),
    ).rejects.toThrow()
  })

  it('rejects negative prices at the DB level', async () => {
    await expect(
      pool.query(`UPDATE subscription_plans SET monthly_price_cents = -1 WHERE slug = 'silver'`),
    ).rejects.toThrow()
  })

  it('limit keys stay consistent between shared constants and seeds', () => {
    for (const plan of DEFAULT_PLANS) {
      expect(Object.keys(plan.entitlements.limits).sort()).toEqual([...LIMIT_KEYS].sort())
      expect(Object.keys(plan.entitlements.features).sort()).toEqual([...FEATURE_KEYS].sort())
    }
  })
})
