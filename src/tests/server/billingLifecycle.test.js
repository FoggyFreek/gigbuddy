import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

let pool, runMigrations, truncateAll, seedTwoTenants
let billingSvc, ingestion, providerFactory
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billingSvc = await import('../../../server/services/billingService.js')
  ingestion = await import('../../../server/services/paymentIngestionService.js')
  providerFactory = await import('../../../server/billing/paymentProvider/index.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  // Give silver + gold real prices so they are subscribable.
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 999, yearly_price_cents = 9999 WHERE slug = 'silver'")
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 1999, yearly_price_cents = 19999 WHERE slug = 'gold'")
  const entMod = await import('../../../server/services/entitlementService.js')
  entMod.clearEntitlementCaches()
  fake = new FakeProvider()
  providerFactory.setPaymentProviderForTests(fake)
})

afterAll(async () => {
  providerFactory.resetPaymentProvider()
  await pool.end()
})

async function planId(slug) {
  const { rows } = await pool.query('SELECT id FROM subscription_plans WHERE slug = $1', [slug])
  return rows[0].id
}
async function sub(subId) {
  const { rows } = await pool.query('SELECT * FROM subscriptions WHERE id = $1', [subId])
  return rows[0]
}
async function paymentIdOf(subId, kind) {
  const { rows } = await pool.query(
    'SELECT mollie_payment_id FROM subscription_payments WHERE subscription_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1',
    [subId, kind],
  )
  return rows[0]?.mollie_payment_id ?? null
}
async function notifCount(userId, type) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int n FROM notifications WHERE user_id = $1 AND type = $2', [userId, type])
  return rows[0].n
}
const userA = () => ({ id: seed.userA.id, email: 'a@test.local', name: 'Alpha User' })

// subscribe → mandate paid → activation
async function subscribeAndActivate(interval = 'month', slug = 'silver') {
  const res = await billingSvc.subscribe(pool, userA(), { planId: await planId(slug), interval })
  const subId = res.subscriptionId
  // Mandate payment paid → trialing + provider subscription created.
  const mandateId = await paymentIdOf(subId, 'mandate_verification')
  fake.settlePayment(mandateId, 'paid')
  await ingestion.ingestProviderPayment(subId, mandateId)
  // Trial conversion charge (provider-generated) paid → active.
  const providerSubId = (await sub(subId)).mollie_subscription_id
  const chargeId = fake.addRecurringCharge(providerSubId, 'cst_1', 999)
  await ingestion.ingestProviderPayment(subId, chargeId)
  return subId
}

describe('subscribe', () => {
  it('creates a pending_mandate subscription with a trial and a mandate payment', async () => {
    const res = await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    expect(res.checkoutUrl).toMatch(/^https:\/\/pay\.test\//)
    expect(res.trial).toBe(true)
    const row = await sub(res.subscriptionId)
    expect(row.status).toBe('pending_mandate')
    expect(row.price_cents).toBe(999)
    expect(row.trial_ends_at).not.toBeNull()
    expect(await paymentIdOf(res.subscriptionId, 'mandate_verification')).toBeTruthy()
  })

  it('rejects a NULL-priced interval with plan_not_priced', async () => {
    await pool.query("UPDATE subscription_plans SET yearly_price_cents = NULL WHERE slug = 'silver'")
    const res = await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'year' })
    expect(res.error.status).toBe(400)
    expect(res.error.body.code).toBe('plan_not_priced')
  })

  it('rejects the free fallback plan', async () => {
    const res = await billingSvc.subscribe(pool, userA(), { planId: await planId('bronze'), interval: 'month' })
    expect(res.error.status).toBe(400)
  })

  it('enforces one live subscription per user', async () => {
    await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    const res = await billingSvc.subscribe(pool, userA(), { planId: await planId('gold'), interval: 'month' })
    expect(res.error.status).toBe(409)
    expect(res.error.body.code).toBe('already_subscribed')
  })

  it('resumes an interrupted signup: re-subscribing the same plan recovers the checkout', async () => {
    const first = await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    const mandateId = await paymentIdOf(first.subscriptionId, 'mandate_verification')

    // The browser never returned from checkout; the user retries the same plan.
    const second = await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    expect(second.error).toBeUndefined()
    expect(second.subscriptionId).toBe(first.subscriptionId)
    expect(second.checkoutUrl).toMatch(/^https:\/\/pay\.test\//)
    // The SAME open payment is recovered — no duplicate mandate row, still one sub.
    expect(await paymentIdOf(first.subscriptionId, 'mandate_verification')).toBe(mandateId)
    const { rows } = await pool.query('SELECT COUNT(*)::int n FROM subscriptions WHERE user_id = $1', [seed.userA.id])
    expect(rows[0].n).toBe(1)
  })

  it('still 409s a re-subscribe to a DIFFERENT plan while pending_mandate', async () => {
    await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    const res = await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'year' })
    expect(res.error.status).toBe(409)
    expect(res.error.body.code).toBe('already_subscribed')
  })

  it('defaults the checkout return URL to the settings billing page', async () => {
    await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    expect(fake.lastMandatePaymentArgs.redirectUrl).toMatch(/\/settings\/billing\?checkout=return$/)
  })

  it("redirect: 'onboarding' returns the checkout to /onboarding", async () => {
    await billingSvc.subscribe(pool, userA(), {
      planId: await planId('silver'), interval: 'month', redirect: 'onboarding',
    })
    expect(fake.lastMandatePaymentArgs.redirectUrl).toMatch(/\/onboarding\?checkout=return$/)
  })

  it('rejects an unknown redirect target', async () => {
    const res = await billingSvc.subscribe(pool, userA(), {
      planId: await planId('silver'), interval: 'month', redirect: 'https://evil.example',
    })
    expect(res.error.status).toBe(400)
  })
})

describe('mandate confirmation', () => {
  it('trial-eligible mandate paid → trialing + provider subscription created', async () => {
    const res = await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    const mandateId = await paymentIdOf(res.subscriptionId, 'mandate_verification')
    fake.settlePayment(mandateId, 'paid')
    await ingestion.ingestProviderPayment(res.subscriptionId, mandateId)
    const row = await sub(res.subscriptionId)
    expect(row.status).toBe('trialing')
    expect(row.mollie_mandate_id).toBeTruthy()
    expect(row.mollie_subscription_id).toBeTruthy() // repair created it
    expect(row.mollie_schedule_stale).toBe(false)
  })

  it('trial-used mandate paid → pending_activation (no access until first charge)', async () => {
    // A prior canceled subscription that once carried a trial marks the trial used.
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, price_cents, trial_ends_at, canceled_at)
       VALUES ($1, $2, 'canceled', 999, NOW() - INTERVAL '30 days', NOW() - INTERVAL '20 days')`,
      [seed.userA.id, await planId('silver')],
    )
    const res = await billingSvc.subscribe(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    expect(res.trial).toBe(false)
    const mandateId = await paymentIdOf(res.subscriptionId, 'mandate_verification')
    fake.settlePayment(mandateId, 'paid')
    await ingestion.ingestProviderPayment(res.subscriptionId, mandateId)
    expect((await sub(res.subscriptionId)).status).toBe('pending_activation')
  })
})

describe('renewal + ingestion idempotency', () => {
  it('activates then renews once, ignoring replays and regressions', async () => {
    const subId = await subscribeAndActivate()
    expect((await sub(subId)).status).toBe('active')
    // No renewal notice on the first activation.
    expect(await notifCount(seed.userA.id, 'billing-renewed')).toBe(0)

    // Next period: a fresh paid recurring charge → one renewal, keyed per period.
    const providerSubId = (await sub(subId)).mollie_subscription_id
    const renewId = fake.addRecurringCharge(providerSubId, 'cst_1', 999, { paidAt: new Date(Date.now() + 60_000) })
    await ingestion.ingestProviderPayment(subId, renewId)
    await ingestion.ingestProviderPayment(subId, renewId) // replay
    await ingestion.ingestProviderPayment(subId, renewId) // replay
    expect(await notifCount(seed.userA.id, 'billing-renewed')).toBe(1)
  })

  it('failed recurring charge → past_due', async () => {
    const subId = await subscribeAndActivate()
    const providerSubId = (await sub(subId)).mollie_subscription_id
    const failId = fake.addRecurringCharge(providerSubId, 'cst_1', 999, { status: 'failed' })
    await ingestion.ingestProviderPayment(subId, failId)
    const row = await sub(subId)
    expect(row.status).toBe('past_due')
    expect(row.past_due_since).not.toBeNull()
    expect(await notifCount(seed.userA.id, 'billing-payment-failed')).toBe(1)
  })
})

describe('cancel / resume', () => {
  it('cancels an active paid subscription at period end and stops the provider schedule', async () => {
    const subId = await subscribeAndActivate()
    const providerSubId = (await sub(subId)).mollie_subscription_id
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id)
    expect(res.atPeriodEnd).toBe(true)
    expect((await sub(subId)).cancel_at_period_end).toBe(true)
    expect(fake.subscriptions.get(providerSubId).status).toBe('canceled')
  })

  it('resume clears the cancel flag and recreates the schedule', async () => {
    const subId = await subscribeAndActivate()
    await billingSvc.cancelSubscription(pool, seed.userA.id)
    const res = await billingSvc.resumeSubscription(pool, seed.userA.id)
    expect(res.resumed).toBe(true)
    const row = await sub(subId)
    expect(row.cancel_at_period_end).toBe(false)
    expect(row.mollie_subscription_id).toBeTruthy()
    expect(row.mollie_schedule_stale).toBe(false)
  })

  it('409s cancel while an upgrade charge is in flight', async () => {
    const subId = await subscribeAndActivate()
    await billingSvc.changePlan(pool, userA(), { planId: await planId('gold'), interval: 'month' })
    // pending plan-change charge is still open (nonterminal).
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id)
    expect(res.error.status).toBe(409)
    expect(res.error.body.code).toBe('plan_change_in_progress')
    expect((await sub(subId)).id).toBe(subId)
  })
})

describe('plan change (upgrade)', () => {
  it('charges on demand, keeps entitlements until paid, then activates with paidAt-based period', async () => {
    const subId = await subscribeAndActivate('month', 'silver')
    const changeRes = await billingSvc.changePlan(pool, userA(), { planId: await planId('gold'), interval: 'month' })
    expect(changeRes.pending).toBe(true)

    // Entitlements unchanged while pending.
    let row = await sub(subId)
    expect(row.plan_id).toBe(await planId('silver'))
    expect(row.pending_plan_id).toBe(await planId('gold'))

    // Pay the plan-change charge → activate-first switch.
    const chargeId = await paymentIdOf(subId, 'plan_change')
    const paidAt = new Date()
    fake.settlePayment(chargeId, 'paid', { paidAt })
    await ingestion.ingestProviderPayment(subId, chargeId)

    row = await sub(subId)
    expect(row.plan_id).toBe(await planId('gold'))
    expect(row.price_cents).toBe(1999)
    expect(row.pending_plan_id).toBeNull()
    expect(row.mollie_schedule_stale).toBe(false) // repaired post-commit
    // Period derives from paidAt + interval (~1 month), not the old schedule.
    const days = (new Date(row.current_period_end) - new Date(row.current_period_start)) / 86_400_000
    expect(days).toBeGreaterThan(27)
    expect(days).toBeLessThan(32)
    expect(await notifCount(seed.userA.id, 'billing-plan-changed')).toBe(1)
  })

  it('rejects a downgrade through change-plan (routes to the downgrade endpoint)', async () => {
    await subscribeAndActivate('month', 'gold')
    const res = await billingSvc.changePlan(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    expect(res.error.status).toBe(400)
    expect(res.error.body.code).toBe('use_downgrade_endpoint')
  })
})

describe('getBillingState', () => {
  it('reports ownedTenantCount = 0 for a participant-only user (seed tenants are ownerless)', async () => {
    const state = await billingSvc.getBillingState(pool, seed.userA.id)
    expect(state.subscription).toBeNull()
    expect(state.ownedTenantCount).toBe(0)
  })

  it('counts active owned tenants and ignores archived ones', async () => {
    await pool.query('UPDATE tenants SET owner_user_id = $1 WHERE id = $2', [seed.userA.id, seed.tenantA.id])
    await pool.query('UPDATE tenants SET owner_user_id = $1, archived_at = NOW() WHERE id = $2', [seed.userA.id, seed.tenantB.id])
    const state = await billingSvc.getBillingState(pool, seed.userA.id)
    expect(state.ownedTenantCount).toBe(1)
  })
})

describe('webhook customer linkage', () => {
  it('ignores a payment whose customer does not match the subscription owner', async () => {
    const subId = await subscribeAndActivate()
    // Forge a recurring charge under a DIFFERENT customer.
    const providerSubId = (await sub(subId)).mollie_subscription_id
    const foreignId = fake.addRecurringCharge(providerSubId, 'cst_999_foreign', 999, { status: 'failed' })
    await ingestion.ingestProviderPayment(subId, foreignId)
    // No past_due: the mismatched customer short-circuited ingestion.
    expect((await sub(subId)).status).toBe('active')
  })
})
