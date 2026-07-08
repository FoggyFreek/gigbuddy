import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FEATURE_KEYS } from '../../../shared/entitlements.js'

let pool, runMigrations, truncateAll, seedTwoTenants
let resolveTenantEntitlements, clearEntitlementCaches
let updatePlan
let billing
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  const entMod = await import('../../../server/services/entitlementService.js')
  resolveTenantEntitlements = entMod.resolveTenantEntitlements
  clearEntitlementCaches = entMod.clearEntitlementCaches
  const planMod = await import('../../../server/services/planService.js')
  updatePlan = planMod.updatePlan
  billing = await import('./_billing.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  clearEntitlementCaches()
})

afterAll(async () => {
  await pool.end()
})

function resolve(tenantId) {
  return resolveTenantEntitlements(pool, tenantId)
}

// Sets userA as owner of tenantA and returns ids for brevity.
async function ownTenantA() {
  await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
  return { tenantId: seed.tenantA.id, userId: seed.userA.id }
}

describe('ownerless tenants (legacy)', () => {
  it('resolves to null — enforcement fully skipped', async () => {
    expect(await resolve(seed.tenantA.id)).toBeNull()
  })
})

describe('fallback-lock states', () => {
  it('owner without any subscription → locked on the fallback plan', async () => {
    const { tenantId } = await ownTenantA()
    const resolved = await resolve(tenantId)
    expect(resolved.locked).toBe(true)
    expect(resolved.planSlug).toBe('bronze')
    expect(resolved.subscriptionStatus).toBeNull()
    for (const key of FEATURE_KEYS) expect(resolved.entitlements.features[key]).toBe(false)
    expect(resolved.entitlements.limits).toEqual({ storage_mb: 50, members: 5, bands: 1 })
  })

  it('pending_mandate and pending_activation grant nothing', async () => {
    const { tenantId, userId } = await ownTenantA()
    const sub = await billing.createSubscription({ userId, status: 'pending_mandate' })
    expect((await resolve(tenantId)).locked).toBe(true)
    await pool.query(`UPDATE subscriptions SET status = 'pending_activation' WHERE id = $1`, [sub.id])
    const resolved = await resolve(tenantId)
    expect(resolved.locked).toBe(true)
    expect(resolved.planSlug).toBe('bronze')
    expect(resolved.subscriptionStatus).toBe('pending_activation')
  })
})

describe('active subscriptions', () => {
  it('active gold within the period → unlocked with gold entitlements', async () => {
    const { tenantId, userId } = await ownTenantA()
    await billing.createSubscription({ userId, planSlug: 'gold' })
    const resolved = await resolve(tenantId)
    expect(resolved.locked).toBe(false)
    expect(resolved.planSlug).toBe('gold')
    expect(resolved.subscriptionStatus).toBe('active')
    for (const key of FEATURE_KEYS) expect(resolved.entitlements.features[key]).toBe(true)
    expect(resolved.entitlements.limits).toEqual({ storage_mb: 500, members: null, bands: null })
  })

  it('stays unlocked for 2 days past period end, then locks', async () => {
    const { tenantId, userId } = await ownTenantA()
    const sub = await billing.createSubscription({
      userId,
      current_period_start: billing.daysFromNow(-31),
      current_period_end: billing.daysFromNow(-1),
    })
    expect((await resolve(tenantId)).locked).toBe(false)
    await pool.query('UPDATE subscriptions SET current_period_end = $2 WHERE id = $1', [
      sub.id, billing.daysFromNow(-3),
    ])
    expect((await resolve(tenantId)).locked).toBe(true)
  })

  it('a nonterminal recurring charge (SEPA in flight) extends access to +7d max', async () => {
    const { tenantId, userId } = await ownTenantA()
    const sub = await billing.createSubscription({
      userId,
      current_period_start: billing.daysFromNow(-33),
      current_period_end: billing.daysFromNow(-3),
    })
    // No in-flight payment → locked at +3d.
    expect((await resolve(tenantId)).locked).toBe(true)
    // Pending recurring charge created after the period started → unlocked.
    const payment = await billing.createSubscriptionPayment(sub.id, {
      status: 'pending',
      mollie_created_at: billing.daysFromNow(-2),
    })
    expect((await resolve(tenantId)).locked).toBe(false)
    // Terminal payment does not extend.
    await pool.query(`UPDATE subscription_payments SET status = 'failed' WHERE id = $1`, [payment.id])
    expect((await resolve(tenantId)).locked).toBe(true)
    // A charge from before the period start does not extend either.
    await billing.createSubscriptionPayment(sub.id, {
      status: 'open',
      mollie_created_at: billing.daysFromNow(-40),
    })
    expect((await resolve(tenantId)).locked).toBe(true)
    // Beyond +7d even an in-flight charge no longer extends.
    await billing.createSubscriptionPayment(sub.id, {
      status: 'pending',
      mollie_created_at: billing.daysFromNow(-2),
    })
    expect((await resolve(tenantId)).locked).toBe(false)
    await pool.query('UPDATE subscriptions SET current_period_end = $2 WHERE id = $1', [
      sub.id, billing.daysFromNow(-8),
    ])
    expect((await resolve(tenantId)).locked).toBe(true)
  })

  it('cancel-at-period-end locks exactly at period end (no grace)', async () => {
    const { tenantId, userId } = await ownTenantA()
    const sub = await billing.createSubscription({
      userId,
      cancel_at_period_end: true,
      current_period_end: billing.daysFromNow(1),
    })
    expect((await resolve(tenantId)).locked).toBe(false)
    await pool.query('UPDATE subscriptions SET current_period_end = NOW() - INTERVAL \'1 hour\' WHERE id = $1', [sub.id])
    const resolved = await resolve(tenantId)
    expect(resolved.locked).toBe(true)
    expect(resolved.planSlug).toBe('bronze')
  })
})

describe('trial and past_due windows', () => {
  it('trialing: unlocked through trial end + 2d grace, locked after', async () => {
    const { tenantId, userId } = await ownTenantA()
    const sub = await billing.createSubscription({
      userId,
      status: 'trialing',
      trial_ends_at: billing.daysFromNow(3),
      current_period_start: null,
      current_period_end: null,
    })
    expect((await resolve(tenantId)).locked).toBe(false)
    await pool.query('UPDATE subscriptions SET trial_ends_at = $2 WHERE id = $1', [sub.id, billing.daysFromNow(-1)])
    expect((await resolve(tenantId)).locked).toBe(false)
    await pool.query('UPDATE subscriptions SET trial_ends_at = $2 WHERE id = $1', [sub.id, billing.daysFromNow(-3)])
    expect((await resolve(tenantId)).locked).toBe(true)
  })

  it('past_due: unlocked for 14 days, locked after', async () => {
    const { tenantId, userId } = await ownTenantA()
    const sub = await billing.createSubscription({
      userId,
      status: 'past_due',
      past_due_since: billing.daysFromNow(-10),
    })
    expect((await resolve(tenantId)).locked).toBe(false)
    await pool.query('UPDATE subscriptions SET past_due_since = $2 WHERE id = $1', [sub.id, billing.daysFromNow(-15)])
    expect((await resolve(tenantId)).locked).toBe(true)
  })
})

describe('complimentary subscriptions', () => {
  it('active without periods, unlocked until the optional expiry', async () => {
    const { tenantId, userId } = await ownTenantA()
    const sub = await billing.createSubscription({
      userId,
      price_cents: 0,
      is_complimentary: true,
      current_period_start: null,
      current_period_end: null,
    })
    expect((await resolve(tenantId)).locked).toBe(false)
    await pool.query('UPDATE subscriptions SET complimentary_expires_at = $2 WHERE id = $1', [
      sub.id, billing.daysFromNow(-1),
    ])
    expect((await resolve(tenantId)).locked).toBe(true)
  })
})

describe('entitlement overrides', () => {
  it('valid overrides merge over the plan; invalid values are ignored', async () => {
    const { tenantId, userId } = await ownTenantA()
    await billing.createSubscription({
      userId,
      planSlug: 'silver',
      entitlement_overrides: {
        features: { finance: true, teleport: true },
        limits: { storage_mb: 1000, members: -5 },
      },
    })
    const resolved = await resolve(tenantId)
    expect(resolved.entitlements.features.finance).toBe(true)
    expect(resolved.entitlements.features.teleport).toBeUndefined()
    expect(resolved.entitlements.limits.storage_mb).toBe(1000)
    expect(resolved.entitlements.limits.members).toBeNull() // silver default kept
  })
})

describe('pending-downgrade limits snapshot', () => {
  it('binds growth limits to min(current, snapshot) while features stay current', async () => {
    const { tenantId, userId } = await ownTenantA()
    await billing.createSubscription({
      userId,
      planSlug: 'gold',
      pending_limits_snapshot: { storage_mb: 50, members: 5, bands: 1 },
    })
    const resolved = await resolve(tenantId)
    expect(resolved.locked).toBe(false)
    expect(resolved.planSlug).toBe('gold')
    for (const key of FEATURE_KEYS) expect(resolved.entitlements.features[key]).toBe(true)
    expect(resolved.entitlements.limits).toEqual({ storage_mb: 50, members: 5, bands: 1 })
  })

  it('an unlimited snapshot value never lowers a limit; missing keys stay current', async () => {
    const { tenantId, userId } = await ownTenantA()
    await billing.createSubscription({
      userId,
      planSlug: 'silver', // 150 / null / 3
      pending_limits_snapshot: { storage_mb: 500, members: null },
    })
    const resolved = await resolve(tenantId)
    expect(resolved.entitlements.limits).toEqual({ storage_mb: 150, members: null, bands: 3 })
  })
})

describe('financeReadOnly', () => {
  it('true when the plan lacks finance but the tenant has finance data', async () => {
    const { tenantId, userId } = await ownTenantA()
    await billing.createSubscription({ userId, planSlug: 'silver' })
    expect((await resolve(tenantId)).financeReadOnly).toBe(false)
    await billing.createFinanceData(tenantId)
    clearEntitlementCaches()
    expect((await resolve(tenantId)).financeReadOnly).toBe(true)
  })

  it('false when the plan includes finance, even with finance data', async () => {
    const { tenantId, userId } = await ownTenantA()
    await billing.createSubscription({ userId, planSlug: 'gold' })
    await billing.createFinanceData(tenantId)
    clearEntitlementCaches()
    expect((await resolve(tenantId)).financeReadOnly).toBe(false)
  })

  it('applies to fallback-locked tenants too', async () => {
    const { tenantId } = await ownTenantA()
    await billing.createFinanceData(tenantId)
    const resolved = await resolve(tenantId)
    expect(resolved.locked).toBe(true)
    expect(resolved.financeReadOnly).toBe(true)
  })
})

describe('fallback plan cache', () => {
  it('plan edits through planService invalidate the cache immediately', async () => {
    const { tenantId } = await ownTenantA()
    expect((await resolve(tenantId)).entitlements.limits.storage_mb).toBe(50)

    const bronze = await billing.getPlanBySlug('bronze')
    const entitlements = JSON.parse(JSON.stringify(bronze.entitlements))
    entitlements.limits.storage_mb = 99
    const result = await updatePlan(pool, bronze.id, { entitlements })
    expect(result.error).toBeUndefined()

    expect((await resolve(tenantId)).entitlements.limits.storage_mb).toBe(99)
  })
})
