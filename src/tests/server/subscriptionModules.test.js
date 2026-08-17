import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'
import { computeProrationCents } from '../../../shared/pricing.js'
import {
  PENDING_CHANGE_KINDS,
  BOUNDARY_KINDS,
  blocksNewChange,
  changeInFlight,
} from '../../../server/commerce/billing/pendingChangeKinds.js'

// Module mechanics: what the trial grants, what a second module costs, and the
// arithmetic behind a mid-cycle change. The proration numbers are asserted
// against the shared pure function rather than restated, so the test cannot
// drift into blessing whatever the implementation happens to produce.
let app, pool, runMigrations, truncateAll, seedTwoTenants, billing
let billingSvc, ingestion, entSvc, limitSvc, providerFactory
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
  entSvc = await import('../../../server/entitlements/entitlementResolver.js')
  limitSvc = await import('../../../server/entitlements/limitService.js')
  providerFactory = await import('../../../server/commerce/billing/paymentProvider/providerFactory.js')
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

// The selected plan is installed unattended by the boundary charge — there is no
// 409 left anywhere in that path — so the selection has to bind the capacity it
// was checked against for the rest of the trial.
describe("a trial's selected paid plan binds its capacity immediately", () => {
  // One short transaction, exactly as a real growing write does it.
  async function memberCapError() {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      return await limitSvc.enforceMemberCap(client, seed.tenantA.id, 'approved')
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  }

  async function selectSilverDuringTrial() {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const res = await billingSvc.changeModule(pool, userA(), {
      audience: 'band', planId: await planId('silver'),
    })
    expect(res.trial).toBe(true)
    entSvc.clearEntitlementCaches()
    return trial.subscription.id
  }

  it('freezes the target limits while features stay on the trial tier', async () => {
    const subId = await selectSilverDuringTrial()

    const module = await billing.getModule(subId, 'band')
    expect(module.plan_id).toBe(await planId('gold')) // still the trial tier
    expect(module.pending_change_kind).toBe('trial_selection')
    expect(module.pending_limits_snapshot.storage_mb).toBe(150) // silver's
    // No data is lost until the plan actually lands, so nothing is frozen to
    // purge and nothing was consented to.
    expect(module.pending_purge_manifest).toBeNull()
    expect(module.downgrade_confirmed_at).toBeNull()

    const resolved = await entSvc.resolveTenantEntitlements(pool, seed.tenantA.id)
    expect(resolved.entitlements.limits.storage_mb).toBe(150) // capacity: silver
    expect(resolved.entitlements.features.finance).toBe(true) // features: gold
  })

  it('refuses growth past the selected cap for the rest of the trial', async () => {
    // Silver is unlimited on members by default; give it a cap the seeded tenant
    // exactly fills, so the selection is allowed and the NEXT add is not.
    await pool.query(
      `UPDATE subscription_plans
          SET entitlements = jsonb_set(entitlements, '{limits,members}', '2')
        WHERE slug = 'silver'`)
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    entSvc.clearEntitlementCaches()
    // Gold is unlimited, so before the selection the add is fine.
    expect(await memberCapError()).toBeNull()

    await billingSvc.changeModule(pool, userA(), { audience: 'band', planId: await planId('silver') })
    entSvc.clearEntitlementCaches()

    const blocked = await memberCapError()
    expect(blocked.error.status).toBe(409)
    expect(blocked.error.body.code).toBe('member_limit_reached')
    expect(blocked.error.body.limit).toBe(2)
  })

  it('re-selecting replaces the binding instead of keeping the tighter one', async () => {
    const subId = await selectSilverDuringTrial()
    // Back to the trial tier: the selection is withdrawn, so nothing binds.
    await billingSvc.changeModule(pool, userA(), { audience: 'band', planId: await planId('gold') })
    const module = await billing.getModule(subId, 'band')
    expect(module.pending_change_kind).toBeNull()
    expect(module.pending_limits_snapshot).toBeNull()
  })

  it('lands the plan at the boundary charge, purging nothing and releasing the binding', async () => {
    const subId = await selectSilverDuringTrial()
    await activatePaidPeriod(subId)

    const module = await billing.getModule(subId, 'band')
    expect(module.plan_id).toBe(await planId('silver'))
    expect(module.pending_change_kind).toBeNull()
    expect(module.pending_purge_manifest).toBeNull()
    // The plan itself now carries these limits. A stale snapshot would outlive
    // the change that froze it and cap a later upgrade at silver.
    expect(module.pending_limits_snapshot).toBeNull()
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

// pendingChangeKinds.js is the one place a kind's semantics are declared. These
// tests are what make that true: they fail if the DB, the derived boundary set,
// the guards or the capacity-binding flows drift away from the table.
describe('pending change kinds are declared once', () => {
  const KINDS = Object.entries(PENDING_CHANGE_KINDS)

  it('matches the DB constraint exactly', async () => {
    const { rows: [row] } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'subscription_modules_pending_change_kind_check'`)
    const inSql = [...row.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(inSql).toEqual(Object.keys(PENDING_CHANGE_KINDS).sort())
  })

  it('derives the boundary set from landsAt', () => {
    expect([...BOUNDARY_KINDS].sort()).toEqual(['downgrade', 'remove', 'trial_selection'])
  })

  it.each(KINDS)('%s: the guard honours its blocksOtherChanges while trialing', (kind, spec) => {
    const module = { status: 'active', pending_change_kind: kind }
    expect(blocksNewChange({ status: 'trialing' }, module)).toBe(spec.blocksOtherChanges === 'always')
    // Once the trial is over, an unlanded change is an in-flight commitment.
    expect(blocksNewChange({ status: 'active' }, module)).toBe(true)
  })

  it('fails closed on a kind the table does not declare', () => {
    const module = { status: 'active', pending_change_kind: 'invented' }
    expect(blocksNewChange({ status: 'trialing' }, module)).toBe(true)
    expect(changeInFlight({ status: 'trialing', pending_payment_id: null }, [module])).toBe(true)
  })

  it('lists exactly the capacity-binding kinds the flows below freeze a snapshot for', () => {
    expect(KINDS.filter(([, s]) => s.bindsCapacity).map(([k]) => k).sort())
      .toEqual(['downgrade', 'remove', 'trial_selection'])
  })

  // Boundary changes are per module; a prorated charge is per subscription. The
  // two guards deliberately ask different questions.
  it('schedules a boundary change per ladder, but refuses a charged one', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await billing.createPersonalTenant(seed.userA.id)
    const sub = await billing.createSubscription({
      userId: seed.userA.id,
      mollie_mandate_id: 'mdt_test',
      total_cents: 3000,
      modules: [
        { planSlug: 'gold', priceCents: 2000 },
        { planSlug: 'artist_gold', priceCents: 1000 },
      ],
    })

    const band = await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'), confirmation: 'downgrade to silver',
    })
    expect(band.scheduled).toBe(true)
    // The artist ladder is its own boundary change and is still allowed.
    const artist = await billingSvc.downgrade(pool, userA(), {
      audience: 'artist', remove: true, confirmation: 'remove artist',
    })
    expect(artist.scheduled).toBe(true)

    // Both capacity-binding kinds froze the limits they were checked against.
    expect((await billing.getModule(sub.id, 'band')).pending_limits_snapshot.storage_mb).toBe(150)
    expect((await billing.getModule(sub.id, 'artist')).pending_limits_snapshot).not.toBeNull()

    // A prorated change must be attributable to exactly one pending change.
    entSvc.clearEntitlementCaches()
    const blocked = await billingSvc.changeModule(pool, userA(), {
      audience: 'band', planId: await planId('gold'),
    })
    expect(blocked.error.status).toBe(409)
    expect(blocked.error.body.code).toBe('plan_change_in_progress')
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
