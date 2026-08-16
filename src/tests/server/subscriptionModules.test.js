import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'
import { computeProrationCents } from '../../../shared/pricing.js'

// Module mechanics: what the trial grants, what a second module costs, and the
// arithmetic behind a mid-cycle change. The proration numbers are asserted
// against the shared pure function rather than restated, so the test cannot
// drift into blessing whatever the implementation happens to produce.
let app, pool, runMigrations, truncateAll, seedTwoTenants, billing
let billingSvc, ingestion, entSvc, providerFactory
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  billing = await import('./_billing.js')
  billingSvc = await import('../../../server/commerce/billing/billingService.js')
  ingestion = await import('../../../server/commerce/billing/paymentIngestionService.js')
  entSvc = await import('../../../server/commerce/billing/entitlementService.js')
  providerFactory = await import('../../../server/commerce/billing/paymentProvider/index.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 999, yearly_price_cents = 9999 WHERE slug = 'silver'")
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 2000, yearly_price_cents = 20000 WHERE slug = 'gold'")
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 1000, yearly_price_cents = 10000 WHERE slug = 'artist_gold'")
  entSvc.clearEntitlementCaches()
  fake = new FakeProvider()
  providerFactory.setPaymentProviderForTests(fake)
})

afterAll(async () => {
  providerFactory.resetPaymentProvider()
  await pool.end()
})

const userA = () => ({ id: seed.userA.id, email: 'a@test.local', name: 'Alpha User' })
const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))

async function planId(slug) {
  const { rows } = await pool.query('SELECT id FROM subscription_plans WHERE slug = $1', [slug])
  return rows[0].id
}
async function subRow(subId) {
  const { rows } = await pool.query('SELECT * FROM subscriptions WHERE id = $1', [subId])
  return rows[0]
}
async function paymentIdOf(subId, kind) {
  const { rows } = await pool.query(
    'SELECT mollie_payment_id FROM subscription_payments WHERE subscription_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1',
    [subId, kind])
  return rows[0]?.mollie_payment_id ?? null
}

async function convert() {
  const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
  const subId = trial.subscription.id
  await activatePaidPeriod(subId)
  return subId
}

async function activatePaidPeriod(subId) {
  const checkout = await billingSvc.checkout(pool, userA(), { interval: 'month' })
  const verificationId = await paymentIdOf(subId, 'mandate_verification')
  fake.settlePayment(verificationId, 'paid')
  await ingestion.ingestProviderPayment(subId, verificationId)

  const scheduled = await subRow(subId)
  const firstChargeId = fake.addRecurringCharge(
    scheduled.mollie_subscription_id,
    `cst_${fake.custSeq}`,
    checkout.totalCents,
    { status: 'paid', paidAt: new Date() },
  )
  await ingestion.ingestProviderPayment(subId, firstChargeId)
}

// Pin the period so proration is arithmetic rather than a race with the clock.
async function setPeriod(subId, { startDaysAgo, endInDays }) {
  const start = new Date(Date.now() - startDaysAgo * 86400000)
  const end = new Date(Date.now() + endInDays * 86400000)
  await pool.query(
    'UPDATE subscriptions SET current_period_start = $2, current_period_end = $3 WHERE id = $1',
    [subId, start, end])
  return { start, end }
}

describe('the trial grants access without a payment method', () => {
  it('never touches the provider, start to finish', async () => {
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    await billingSvc.changeModule(pool, userA(), { audience: 'artist', planId: await planId('artist_gold') })
    await billingSvc.downgrade(pool, userA(), {
      audience: 'artist', remove: true, confirmation: 'remove artist',
    })
    expect(fake.calls).toEqual([])
  })

  it('refuses a second subscription while one is live', async () => {
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const res = await billingSvc.startTrial(pool, userA(), { audience: 'artist' })
    expect(res.error.body.code).toBe('already_subscribed')
  })

  it('blocks a trial whose limits are already exceeded', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    // artist_gold allows 250 MB; the personal workspace is already past it.
    // (Members cannot be the lever here — a personal tenant is pinned to its
    // single owner member by design.)
    const personal = await billing.createPersonalTenant(seed.userA.id)
    await pool.query(
      'INSERT INTO tenant_statistics (tenant_id, storage_bytes) VALUES ($1, $2)',
      [personal.id, 400 * 1024 * 1024])

    const res = await billingSvc.startTrial(pool, userA(), { audience: 'artist' })
    expect(res.error.status).toBe(409)
    expect(res.error.body.code).toBe('over_target_limit')
  })
})

describe('mid-cycle proration', () => {
  it('matches the shared pure function exactly, halfway through', async () => {
    const subId = await convert()
    const { start, end } = await setPeriod(subId, { startDaysAgo: 15, endInDays: 15 })

    const preview = await billingSvc.previewModuleChange(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })

    const expected = computeProrationCents({
      oldTotalCents: 2000, newTotalCents: 3000,
      periodStart: start, periodEnd: end, now: new Date(),
    })
    expect(preview.prorationCents).toBe(expected)
    expect(preview.snapshot.totalCents).toBe(3000)
  })

  it('charges nearly the full difference at the very start of a period', async () => {
    const subId = await convert()
    await setPeriod(subId, { startDaysAgo: 0.01, endInDays: 29.99 })
    const preview = await billingSvc.previewModuleChange(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    expect(preview.prorationCents).toBeGreaterThan(995)
    expect(preview.prorationCents).toBeLessThanOrEqual(1000)
  })

  it('charges almost nothing at the very end of a period', async () => {
    const subId = await convert()
    await setPeriod(subId, { startDaysAgo: 29.99, endInDays: 0.01 })
    const preview = await billingSvc.previewModuleChange(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    expect(preview.prorationCents).toBeLessThan(5)
  })

  it('quotes an upgrade of an existing module on the DIFFERENCE, not the full price', async () => {
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    await billingSvc.changeModule(pool, userA(), {
      audience: 'band', planId: await planId('silver'),
    })
    await activatePaidPeriod(trial.subscription.id)
    await setPeriod(trial.subscription.id, { startDaysAgo: 15, endInDays: 15 })

    const preview = await billingSvc.previewModuleChange(pool, userA(), {
      audience: 'band', planId: await planId('gold'),
    })
    // 2000 - 999 = 1001 over half a period, not 2000.
    expect(preview.snapshot.totalCents).toBe(2000)
    expect(preview.prorationCents).toBeGreaterThan(480)
    expect(preview.prorationCents).toBeLessThan(520)
  })

  it('costs nothing during a trial — there is no paid period to prorate against', async () => {
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const preview = await billingSvc.previewModuleChange(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    expect(preview.prorationCents).toBe(0)
  })
})

describe('the prorated charge is idempotent per amount', () => {
  it('a re-issued charge for a DIFFERENT amount is not swallowed by the outbox', async () => {
    const subId = await convert()
    await setPeriod(subId, { startDaysAgo: 15, endInDays: 15 })
    await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    const firstKey = (await pool.query(
      "SELECT idempotency_key FROM billing_operations WHERE op_type = 'module_change_charge'")).rows[0].idempotency_key

    // Fail it, then repeat the same change at a different point in the period.
    const payId = await paymentIdOf(subId, 'proration')
    fake.settlePayment(payId, 'failed')
    await ingestion.ingestProviderPayment(subId, payId)
    await setPeriod(subId, { startDaysAgo: 25, endInDays: 5 })
    await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })

    const { rows } = await pool.query(
      "SELECT idempotency_key FROM billing_operations WHERE op_type = 'module_change_charge' ORDER BY id")
    expect(rows).toHaveLength(2)
    // The amount is part of the key, so the cheaper second charge is a distinct
    // operation instead of colliding and silently reusing the first payment.
    expect(rows[1].idempotency_key).not.toBe(firstKey)
  })
})

describe('module state through a change', () => {
  it('grants nothing from a pending module and everything once it is paid', async () => {
    const personal = await billing.createPersonalTenant(seed.userA.id)
    const subId = await convert()
    await setPeriod(subId, { startDaysAgo: 15, endInDays: 15 })

    await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    entSvc.clearEntitlementCaches()
    expect((await entSvc.resolveTenantEntitlements(pool, personal.id)).locked).toBe(true)

    const payId = await paymentIdOf(subId, 'proration')
    fake.settlePayment(payId, 'paid')
    await ingestion.ingestProviderPayment(subId, payId)
    entSvc.clearEntitlementCaches()

    const resolved = await entSvc.resolveTenantEntitlements(pool, personal.id)
    expect(resolved.locked).toBe(false)
    expect(resolved.planSlug).toBe('artist_gold')
  })

  it('re-prices the next renewal and the provider schedule after the change lands', async () => {
    const subId = await convert()
    await setPeriod(subId, { startDaysAgo: 15, endInDays: 15 })
    await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    const payId = await paymentIdOf(subId, 'proration')
    fake.settlePayment(payId, 'paid')
    await ingestion.ingestProviderPayment(subId, payId)

    const row = await subRow(subId)
    expect(row.next_total_cents).toBe(3000)
    expect(fake.subscriptions.get(row.mollie_subscription_id).amountCents).toBe(3000)
  })
})

describe('HTTP surface', () => {
  it('exposes trial, preview and module endpoints to the owner', async () => {
    const created = await asUserA(request(app).post('/api/billing/trial')).send({ audience: 'band' }).expect(201)
    expect(created.body.subscription.status).toBe('trialing')

    const state = await asUserA(request(app).get('/api/billing')).expect(200)
    expect(state.body.subscription.modules).toHaveLength(1)
    expect(state.body.trialAvailable).toBe(false)

    await asUserA(request(app).post('/api/billing/modules'))
      .send({ audience: 'artist', planId: await planId('artist_gold') }).expect(200)

    const after = await asUserA(request(app).get('/api/billing')).expect(200)
    expect(after.body.subscription.modules).toHaveLength(2)
  })

  it('rejects a malformed audience before touching any state', async () => {
    const res = await asUserA(request(app).post('/api/billing/trial')).send({ audience: 'nope' }).expect(400)
    expect(res.body.error).toMatch(/audience/)
    const { rows } = await pool.query('SELECT COUNT(*)::int n FROM subscriptions')
    expect(rows[0].n).toBe(0)
  })

  it("never shows one user another user's subscription", async () => {
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const asUserB = (req) => req
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(seed.tenantB.id))

    const res = await asUserB(request(app).get('/api/billing')).expect(200)
    expect(res.body.subscription).toBeNull()
    expect(res.body.trialAvailable).toBe(true)
  })

  it("refuses to cancel or change another user's subscription', even by guessing", async () => {
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const asUserB = (req) => req
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(seed.tenantB.id))

    // userB has no subscription, so every mutation is a 404 — userA's row is
    // never reachable from another account.
    await asUserB(request(app).post('/api/billing/cancel')).send({}).expect(404)
    await asUserB(request(app).post('/api/billing/modules'))
      .send({ audience: 'band', planId: await planId('gold') }).expect(404)
  })
})
