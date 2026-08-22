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

const BUNDLE = {
  code: 'dual_module_bundle',
  name: 'Dual module bundle',
  discount_type: 'percentage',
  percent: 10,
  combinable: false,
  required_audiences: ['band', 'artist'],
  min_module_count: 2,
}

function createRule(body = BUNDLE) {
  return asSuper(request(app).post('/api/admin/pricing-rules')).send(body)
}

describe('pricing rule access', () => {
  it('is super-admin only', async () => {
    await asUserA(request(app).get('/api/admin/pricing-rules')).expect(403)
    await asUserA(request(app).post('/api/admin/pricing-rules')).send(BUNDLE).expect(403)
    await asSuper(request(app).get('/api/admin/pricing-rules')).expect(200)
  })
})

describe('creating a pricing rule', () => {
  it('creates version 1, active by default', async () => {
    const res = await createRule().expect(201)
    expect(res.body).toMatchObject({
      code: 'dual_module_bundle',
      version: 1,
      discount_type: 'percentage',
      is_active: true,
      min_module_count: 2,
    })
    expect(Number(res.body.percent)).toBe(10)
    expect(res.body.required_audiences).toEqual(['band', 'artist'])
    expect(res.body.billing_intervals).toEqual(['month', 'year'])
  })

  it('creates a fixed-amount rule', async () => {
    const res = await createRule({
      code: 'apr_2027_marketing',
      name: 'April 2027 campaign',
      discount_type: 'fixed',
      amount_cents: 500,
      effective_from: '2027-04-01T00:00:00.000Z',
      effective_to: '2027-05-01T00:00:00.000Z',
    }).expect(201)
    expect(res.body.amount_cents).toBe(500)
    expect(res.body.percent).toBeNull()
  })

  it('rejects a value that does not match the discount type', async () => {
    await createRule({ ...BUNDLE, discount_type: 'fixed', percent: 10 }).expect(400)
    await createRule({ ...BUNDLE, percent: undefined, amount_cents: 500 }).expect(400)
    await createRule({ ...BUNDLE, percent: 0 }).expect(400)
    await createRule({ ...BUNDLE, percent: 101 }).expect(400)
  })

  it('rejects malformed conditions', async () => {
    await createRule({ ...BUNDLE, required_audiences: ['band', 'nope'] }).expect(400)
    await createRule({ ...BUNDLE, billing_intervals: [] }).expect(400)
    await createRule({ ...BUNDLE, billing_intervals: ['week'] }).expect(400)
    await createRule({ ...BUNDLE, min_module_count: 0 }).expect(400)
    await createRule({ ...BUNDLE, code: 'Not A Code' }).expect(400)
    await createRule({ ...BUNDLE, name: '  ' }).expect(400)
  })

  it('rejects an inverted effective window', async () => {
    await createRule({
      ...BUNDLE,
      effective_from: '2027-05-01T00:00:00.000Z',
      effective_to: '2027-04-01T00:00:00.000Z',
    }).expect(400)
  })

  it('refuses a second live rule for the same code', async () => {
    await createRule().expect(201)
    const res = await createRule().expect(409)
    expect(res.body.code).toBe('code_already_live')
  })
})

describe('editing a pricing rule', () => {
  it('renames in place without changing the version', async () => {
    const { body: created } = await createRule().expect(201)
    const res = await asSuper(request(app).patch(`/api/admin/pricing-rules/${created.id}`))
      .send({ name: 'Bundle deal' }).expect(200)
    expect(res.body).toMatchObject({ id: created.id, version: 1, name: 'Bundle deal' })
  })

  it('refuses to edit pricing semantics in place', async () => {
    const { body: created } = await createRule().expect(201)
    const res = await asSuper(request(app).patch(`/api/admin/pricing-rules/${created.id}`))
      .send({ percent: 15 }).expect(400)
    expect(res.body.code).toBe('use_version_endpoint')
  })

  it('deactivates in place', async () => {
    const { body: created } = await createRule().expect(201)
    const res = await asSuper(request(app).patch(`/api/admin/pricing-rules/${created.id}`))
      .send({ is_active: false }).expect(200)
    expect(res.body.is_active).toBe(false)

    // The code is free again once nothing live holds it.
    await createRule().expect(201)
  })

  it('404s an unknown rule', async () => {
    await asSuper(request(app).patch('/api/admin/pricing-rules/999999')).send({ name: 'x' }).expect(404)
  })
})

describe('versioning a pricing rule', () => {
  it('supersedes the live version and keeps the old row readable', async () => {
    const { body: v1 } = await createRule().expect(201)

    const res = await asSuper(request(app).post(`/api/admin/pricing-rules/${v1.id}/versions`))
      .send({ ...BUNDLE, percent: 15 }).expect(201)
    expect(res.body).toMatchObject({ code: 'dual_module_bundle', version: 2, is_active: true })
    expect(Number(res.body.percent)).toBe(15)

    const { rows } = await pool.query(
      'SELECT version, is_active, percent FROM pricing_rules WHERE code = $1 ORDER BY version',
      ['dual_module_bundle'],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ version: 1, is_active: false })
    // The row that priced an existing agreement is still on disk, unchanged.
    expect(Number(rows[0].percent)).toBe(10)
  })

  it('may change the discount type across versions', async () => {
    const { body: v1 } = await createRule().expect(201)
    const res = await asSuper(request(app).post(`/api/admin/pricing-rules/${v1.id}/versions`))
      .send({ ...BUNDLE, discount_type: 'fixed', percent: undefined, amount_cents: 250 }).expect(201)
    expect(res.body).toMatchObject({ version: 2, discount_type: 'fixed', amount_cents: 250 })
    expect(res.body.percent).toBeNull()
  })

  it('numbers versions above the highest ever used, not the live one', async () => {
    const { body: v1 } = await createRule().expect(201)
    const { body: v2 } = await asSuper(request(app).post(`/api/admin/pricing-rules/${v1.id}/versions`))
      .send({ ...BUNDLE, percent: 15 }).expect(201)
    await asSuper(request(app).patch(`/api/admin/pricing-rules/${v2.id}`))
      .send({ is_active: false }).expect(200)

    // Nothing live now; a plain create must not reuse version 1.
    const { body: v3 } = await createRule().expect(201)
    expect(v3.version).toBe(3)
  })

  it('refuses to version a rule that is no longer live', async () => {
    const { body: v1 } = await createRule().expect(201)
    await asSuper(request(app).patch(`/api/admin/pricing-rules/${v1.id}`)).send({ is_active: false }).expect(200)
    const res = await asSuper(request(app).post(`/api/admin/pricing-rules/${v1.id}/versions`))
      .send({ ...BUNDLE, percent: 15 }).expect(409)
    expect(res.body.code).toBe('rule_not_live')
  })

  it('validates the new version like a create', async () => {
    const { body: v1 } = await createRule().expect(201)
    await asSuper(request(app).post(`/api/admin/pricing-rules/${v1.id}/versions`))
      .send({ ...BUNDLE, percent: 0 }).expect(400)
    // The failed attempt left the live version untouched.
    const { rows } = await pool.query('SELECT is_active FROM pricing_rules WHERE id = $1', [v1.id])
    expect(rows[0].is_active).toBe(true)
  })
})

describe('listing pricing rules', () => {
  it('returns every version, newest code group first, and flags the live one', async () => {
    const { body: v1 } = await createRule().expect(201)
    await asSuper(request(app).post(`/api/admin/pricing-rules/${v1.id}/versions`))
      .send({ ...BUNDLE, percent: 15 }).expect(201)
    await createRule({ ...BUNDLE, code: 'apr_2027_marketing', discount_type: 'fixed', percent: undefined, amount_cents: 500 }).expect(201)

    const res = await asSuper(request(app).get('/api/admin/pricing-rules')).expect(200)
    expect(res.body).toHaveLength(3)
    const bundle = res.body.filter((r) => r.code === 'dual_module_bundle')
    expect(bundle.map((r) => r.version)).toEqual([2, 1])
    expect(bundle.map((r) => r.is_active)).toEqual([true, false])
  })
})

describe('database backstops', () => {
  it('refuses two live versions of one code', async () => {
    await createRule().expect(201)
    await expect(pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent)
       VALUES ('dual_module_bundle', 2, 'x', 'percentage', 10)`,
    )).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses a value that contradicts the discount type', async () => {
    await expect(pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent, amount_cents)
       VALUES ('x', 1, 'x', 'percentage', 10, 500)`,
    )).rejects.toMatchObject({ code: '23514' })
  })

  it('refuses an unknown audience or interval', async () => {
    await expect(pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent, required_audiences)
       VALUES ('x', 1, 'x', 'percentage', 10, ARRAY['nope'])`,
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent, billing_intervals)
       VALUES ('y', 1, 'y', 'percentage', 10, ARRAY['week'])`,
    )).rejects.toMatchObject({ code: '23514' })
  })
})
