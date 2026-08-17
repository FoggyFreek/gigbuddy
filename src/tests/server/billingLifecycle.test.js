import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

// The subscription lifecycle end to end: one payment-free trial start, a €0.01
// mandate verification, the combined charge scheduled at trial end, prorated
// mid-cycle changes that preserve the renewal date, and one combined renewal.
let pool, runMigrations, truncateAll, seedTwoTenants
let billingSvc, ingestion, providerFactory, entitlementSvc, billing
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billingSvc = await import('../../../server/commerce/billing/billingService.js')
  ingestion = await import('../../../server/commerce/billing/paymentIngestionService.js')
  providerFactory = await import('../../../server/commerce/billing/paymentProvider/providerFactory.js')
  entitlementSvc = await import('../../../server/entitlements/entitlementResolver.js')
  billing = await import('./_billing.js')
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
  entitlementSvc.clearEntitlementCaches()
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
async function modules(subId) {
  const { rows } = await pool.query(
    'SELECT * FROM subscription_modules WHERE subscription_id = $1 ORDER BY audience', [subId])
  return rows
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
async function paymentRow(molliePaymentId) {
  const { rows } = await pool.query(
    'SELECT * FROM subscription_payments WHERE mollie_payment_id = $1', [molliePaymentId])
  return rows[0] ?? null
}
const userA = () => ({ id: seed.userA.id, email: 'a@test.local', name: 'Alpha User' })
const userB = () => ({ id: seed.userB.id, email: 'b@test.local', name: 'Beta User' })

// trial → €0.01 mandate verification → delayed first recurring charge → active.
async function convert({ interval = 'month', audience = 'band', second = null } = {}) {
  const trial = await billingSvc.startTrial(pool, userA(), { audience })
  const subId = trial.subscription.id
  if (second) await billingSvc.changeModule(pool, userA(), { audience: second, planId: await planId(second === 'artist' ? 'artist_gold' : 'gold') })
  const co = await billingSvc.checkout(pool, userA(), { interval })
  const verificationId = await paymentIdOf(subId, 'mandate_verification')
  fake.settlePayment(verificationId, 'paid')
  await ingestion.ingestProviderPayment(subId, verificationId)

  const scheduled = await sub(subId)
  // The helper settles immediately to exercise post-activation behavior. The
  // separate scheduling test below pins the real provider startDate.
  const paidAt = new Date()
  const payId = fake.addRecurringCharge(
    scheduled.mollie_subscription_id,
    `cst_${fake.custSeq}`,
    co.totalCents,
    { status: 'paid', paidAt },
  )
  await ingestion.ingestProviderPayment(subId, payId)
  return { subId, totalCents: co.totalCents, payId, verificationId }
}

describe('the free trial', () => {
  it('starts a 30-day Gold trial with one module and NO provider contact', async () => {
    const res = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    expect(res.error).toBeUndefined()
    expect(res.trialDays).toBe(30)

    const row = await sub(res.subscription.id)
    expect(row.status).toBe('trialing')
    expect(row.billing_interval).toBeNull() // no cycle chosen yet
    expect(row.mollie_mandate_id).toBeNull()
    expect(row.mollie_subscription_id).toBeNull()
    const days = Math.round((new Date(row.trial_ends_at) - Date.now()) / 86400000)
    expect(days).toBe(30)

    const mods = await modules(res.subscription.id)
    expect(mods).toHaveLength(1)
    expect(mods[0].audience).toBe('band')
    expect(mods[0].is_starter).toBe(true)
    // Starting the trial itself never asks the provider for payment details.
    expect(fake.calls).toEqual([])
  })

  it('grants the trial tier by FLAG, surviving a renamed slug', async () => {
    await pool.query("UPDATE subscription_plans SET slug = 'goud' WHERE slug = 'gold'")
    const res = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const mods = await modules(res.subscription.id)
    const { rows } = await pool.query('SELECT slug FROM subscription_plans WHERE id = $1', [mods[0].plan_id])
    expect(rows[0].slug).toBe('goud')
  })

  it('refuses when no trial tier is configured', async () => {
    await pool.query("UPDATE subscription_plans SET is_trial_tier = FALSE WHERE audience = 'band'")
    const res = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    expect(res.error.body.code).toBe('trial_tier_missing')
  })

  it('is once per customer, whichever module sampled it', async () => {
    const first = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    await pool.query("UPDATE subscriptions SET status = 'canceled' WHERE id = $1", [first.subscription.id])

    const again = await billingSvc.startTrial(pool, userA(), { audience: 'artist' })
    expect(again.error.body.code).toBe('trial_used')
  })

  it('adds a second module free, WITHOUT extending the trial', async () => {
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const before = (await sub(trial.subscription.id)).trial_ends_at

    const res = await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    expect(res).toMatchObject({ changed: true, trial: true })

    const after = await sub(trial.subscription.id)
    expect(after.trial_ends_at).toEqual(before)
    expect(await modules(trial.subscription.id)).toHaveLength(2)
    expect(fake.calls).toEqual([]) // still free, still no provider
  })

  it('keeps Gold trial access while selecting Band Silver for the paid period', async () => {
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const silverId = await planId('silver')

    const selected = await billingSvc.changeModule(pool, userA(), {
      audience: 'band', planId: silverId,
    })
    expect(selected).toMatchObject({ changed: true, trial: true })

    const [module] = await modules(trial.subscription.id)
    expect(module.plan_id).toBe(await planId('gold'))
    expect(module.pending_plan_id).toBe(silverId)
    expect(module.pending_change_kind).toBe('trial_selection')

    const state = await billingSvc.getBillingState(pool, seed.userA.id)
    expect(state.checkoutQuotes.month.modules.band).toEqual({ plan: 'silver', priceCents: 999 })
    expect(state.checkoutQuotes.month.totalCents).toBe(999)
  })

  it('activates the selected Band Silver plan only when the first paid period starts', async () => {
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const subId = trial.subscription.id
    await billingSvc.changeModule(pool, userA(), {
      audience: 'band', planId: await planId('silver'),
    })

    const checkout = await billingSvc.checkout(pool, userA(), { interval: 'month' })
    const verificationId = await paymentIdOf(subId, 'mandate_verification')
    fake.settlePayment(verificationId, 'paid')
    await ingestion.ingestProviderPayment(subId, verificationId)

    const scheduled = await sub(subId)
    const providerSchedule = fake.subscriptions.get(scheduled.mollie_subscription_id)
    expect(providerSchedule.amountCents).toBe(999)

    const firstChargeId = fake.addRecurringCharge(
      scheduled.mollie_subscription_id,
      `cst_${fake.custSeq}`,
      checkout.totalCents,
      { status: 'paid', paidAt: new Date() },
    )
    await ingestion.ingestProviderPayment(subId, firstChargeId)

    const [module] = await modules(subId)
    expect(module.plan_id).toBe(await planId('silver'))
    expect(module.pending_change_kind).toBeNull()
    expect((await sub(subId)).status).toBe('active')
  })

  it('grants entitlements immediately, with no payment at all', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })

    const resolved = await entitlementSvc.resolveTenantEntitlements(pool, seed.tenantA.id)
    expect(resolved.locked).toBe(false)
    expect(resolved.planSlug).toBe('gold')
  })
})

describe('trial conversion', () => {
  it('takes only the verification payment during the trial and activates on the delayed charge', async () => {
    const { subId, totalCents } = await convert({ second: 'artist' })
    expect(totalCents).toBe(3000) // 2000 band gold + 1000 artist gold

    const row = await sub(subId)
    expect(row.status).toBe('active')
    expect(row.total_cents).toBe(3000)
    expect(row.converted_at).not.toBeNull()
    expect(row.last_charge_at).not.toBeNull()
    expect(row.price_snapshot.subtotalCents).toBe(3000)
    expect(row.price_snapshot.modules).toEqual({
      band: { plan: 'gold', priceCents: 2000 },
      artist: { plan: 'artist_gold', priceCents: 1000 },
    })

    // The only immediate payment is the disclosed mandate verification. The
    // subscription total is first charged by the provider schedule at trial end.
    const { rows } = await pool.query(
      'SELECT kind, amount_cents FROM subscription_payments WHERE subscription_id = $1 ORDER BY id', [subId])
    expect(rows).toEqual([
      { kind: 'mandate_verification', amount_cents: 1 },
      { kind: 'recurring', amount_cents: 3000 },
    ])
  })

  it('schedules the first real charge for the trial end date', async () => {
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const checkout = await billingSvc.checkout(pool, userA(), { interval: 'month' })
    const verificationId = await paymentIdOf(trial.subscription.id, 'mandate_verification')

    expect(checkout).toMatchObject({ verificationCents: 1, totalCents: 2000 })
    expect(fake.lastMandatePaymentArgs.amountCents).toBe(1)

    fake.settlePayment(verificationId, 'paid')
    await ingestion.ingestProviderPayment(trial.subscription.id, verificationId)

    const row = await sub(trial.subscription.id)
    expect(row.status).toBe('trialing')
    const schedule = fake.subscriptions.get(row.mollie_subscription_id)
    expect(schedule.amountCents).toBe(2000)
    expect(schedule.startAt.toISOString()).toBe(new Date(row.trial_ends_at).toISOString())
  })

  it('reuses an open mandate-verification checkout instead of creating a second charge', async () => {
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })

    const first = await billingSvc.checkout(pool, userA(), { interval: 'month' })
    const second = await billingSvc.checkout(pool, userA(), { interval: 'month' })

    expect(second.checkoutUrl).toBe(first.checkoutUrl)
    expect(fake.calls.filter((call) => call === 'createCheckoutPayment')).toHaveLength(1)
  })

  it('creates the recurring schedule at the combined amount, starting at period end', async () => {
    const { subId } = await convert({ second: 'artist' })
    const row = await sub(subId)

    expect(row.mollie_subscription_id).toBeTruthy()
    expect(row.mollie_schedule_stale).toBe(false)
    const schedule = fake.subscriptions.get(row.mollie_subscription_id)
    expect(schedule.amountCents).toBe(3000)
    expect(schedule.interval).toBe('month')
  })

  it('prices the yearly interval from the yearly columns', async () => {
    const { totalCents } = await convert({ interval: 'year', second: 'artist' })
    expect(totalCents).toBe(30000)
  })

  it('applies a bundle discount to the combined total', async () => {
    await pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent,
                                  required_audiences, min_module_count)
       VALUES ('dual_module_bundle', 1, 'Bundle', 'percentage', 10, ARRAY['band','artist'], 2)`,
    )
    const { subId, totalCents } = await convert({ second: 'artist' })
    expect(totalCents).toBe(2700) // 3000 - 10%

    const row = await sub(subId)
    expect(row.price_snapshot.discounts).toEqual([
      { code: 'dual_module_bundle', name: 'Bundle', version: 1, type: 'percentage', value: 10, amountCents: 300 },
    ])
    expect(fake.subscriptions.get(row.mollie_subscription_id).amountCents).toBe(2700)
  })

  it('leaves a single-module subscription undiscounted by a dual-module rule', async () => {
    await pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent,
                                  required_audiences, min_module_count)
       VALUES ('dual_module_bundle', 1, 'Bundle', 'percentage', 10, ARRAY['band','artist'], 2)`,
    )
    const { totalCents } = await convert()
    expect(totalCents).toBe(2000)
  })

  it('keeps trial access while mandate verification is in flight', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    await billingSvc.checkout(pool, userA(), { interval: 'month' })

    expect((await sub(trial.subscription.id)).status).toBe('trialing')
    expect((await entitlementSvc.resolveTenantEntitlements(pool, seed.tenantA.id)).locked).toBe(false)
  })

  it('rejects an interval a module is not priced for', async () => {
    await pool.query("UPDATE subscription_plans SET yearly_price_cents = NULL WHERE slug = 'gold'")
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const res = await billingSvc.checkout(pool, userA(), { interval: 'year' })
    expect(res.error.body.code).toBe('plan_not_priced')
  })

  it('refuses to convert an already-active subscription', async () => {
    await convert()
    const res = await billingSvc.checkout(pool, userA(), { interval: 'month' })
    expect(res.error.body.code).toBe('already_active')
  })

  it('notifies the customer that the subscription is live', async () => {
    await convert()
    expect(await notifCount(seed.userA.id, 'billing-activated')).toBe(1)
  })

  it('clears the onboarding pointer when a delayed first payment settles', async () => {
    await pool.query('UPDATE users SET onboarding_tenant_id = $2 WHERE id = $1', [
      seed.userA.id, seed.tenantA.id,
    ])

    const checkout = await billingSvc.subscribe(pool, userA(), {
      audience: 'band', planId: await planId('silver'), interval: 'month', redirect: 'onboarding',
    })
    const payId = await paymentIdOf(checkout.subscriptionId, 'conversion')

    const pointer = async () => {
      const { rows } = await pool.query(
        'SELECT onboarding_tenant_id FROM users WHERE id = $1', [seed.userA.id],
      )
      return rows[0].onboarding_tenant_id
    }

    // A checkout timeout must remain resumable while the payment is pending.
    expect(await pointer()).toBe(seed.tenantA.id)

    fake.settlePayment(payId, 'paid')
    await ingestion.ingestProviderPayment(checkout.subscriptionId, payId)

    expect((await sub(checkout.subscriptionId)).status).toBe('active')
    expect(await pointer()).toBeNull()
  })
})

describe('mid-cycle module changes', () => {
  it('charges only the prorated difference and PRESERVES the renewal date', async () => {
    const { subId } = await convert()
    const before = await sub(subId)

    // Halfway through the period, add the artist module.
    const mid = new Date((new Date(before.current_period_start).getTime()
      + new Date(before.current_period_end).getTime()) / 2)
    await pool.query('UPDATE subscriptions SET current_period_start = $2, current_period_end = $3 WHERE id = $1',
      [subId, new Date(Date.now() - 15 * 86400000), new Date(Date.now() + 15 * 86400000)])

    const res = await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    expect(res).toMatchObject({ changed: true, pending: true })
    // 1000 extra for roughly half the period.
    expect(res.amountCents).toBeGreaterThan(450)
    expect(res.amountCents).toBeLessThan(550)
    expect(mid).toBeInstanceOf(Date)

    // Entitlements do NOT move until the charge is paid (activate-first).
    const pending = await modules(subId)
    expect(pending.find((m) => m.audience === 'artist').status).toBe('pending')

    const periodEndBefore = (await sub(subId)).current_period_end
    const payId = await paymentIdOf(subId, 'proration')
    fake.settlePayment(payId, 'paid')
    await ingestion.ingestProviderPayment(subId, payId)

    const after = await sub(subId)
    expect(after.current_period_end).toEqual(periodEndBefore) // the whole point
    expect(after.total_cents).toBe(3000)
    expect((await modules(subId)).find((m) => m.audience === 'artist').status).toBe('active')
  })

  it('drops the module when the prorated charge fails terminally', async () => {
    const { subId } = await convert()
    await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    const payId = await paymentIdOf(subId, 'proration')
    fake.settlePayment(payId, 'failed')
    await ingestion.ingestProviderPayment(subId, payId)

    expect(await modules(subId)).toHaveLength(1)
    expect((await sub(subId)).pending_price_snapshot).toBeNull()
    expect(await notifCount(seed.userA.id, 'billing-payment-failed')).toBe(1)
  })

  it('applies immediately and free when a bundle discount makes the total DROP', async () => {
    // A 60% dual-module discount takes 3000 below the 2000 already being paid,
    // so nothing is owed now and the module lands at once.
    await pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent,
                                  required_audiences, min_module_count)
       VALUES ('big_bundle', 1, 'Big bundle', 'percentage', 60, ARRAY['band','artist'], 2)`,
    )
    const { subId } = await convert()
    const res = await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    expect(res).toMatchObject({ changed: true, immediate: true })
    expect((await modules(subId)).find((m) => m.audience === 'artist').status).toBe('active')
    expect((await sub(subId)).total_cents).toBe(1200)
  })

  it('routes a lower tier to the downgrade endpoint', async () => {
    const { subId } = await convert()
    expect(subId).toBeTruthy()
    const res = await billingSvc.changeModule(pool, userA(), {
      audience: 'band', planId: await planId('silver'),
    })
    expect(res.error.body.code).toBe('use_downgrade_endpoint')
  })

  it('refuses a second change while one is in flight', async () => {
    await convert()
    await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    const res = await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })
    expect(res.error.body.code).toBe('plan_change_in_progress')
  })
})

describe('renewal', () => {
  it('advances the period, re-anchors the refund window, and notifies', async () => {
    const { subId } = await convert()
    const row = await sub(subId)
    // Age the subscription so the renewal charge opens a new period.
    await pool.query('UPDATE subscriptions SET current_period_start = $2, current_period_end = $3 WHERE id = $1',
      [subId, new Date(Date.now() - 40 * 86400000), new Date(Date.now() - 10 * 86400000)])

    const chargeId = fake.addRecurringCharge(row.mollie_subscription_id, 'cst_1', 2000)
    await ingestion.ingestProviderPayment(subId, chargeId)

    const after = await sub(subId)
    expect(after.status).toBe('active')
    expect(new Date(after.current_period_end).getTime()).toBeGreaterThan(Date.now())
    expect(new Date(after.last_charge_at).getTime()).toBeGreaterThan(Date.now() - 60000)
    expect(await notifCount(seed.userA.id, 'billing-renewed')).toBe(1)
  })

  it('is idempotent — a replayed renewal changes nothing and notifies once', async () => {
    const { subId } = await convert()
    const row = await sub(subId)
    await pool.query('UPDATE subscriptions SET current_period_start = $2, current_period_end = $3 WHERE id = $1',
      [subId, new Date(Date.now() - 40 * 86400000), new Date(Date.now() - 10 * 86400000)])

    const chargeId = fake.addRecurringCharge(row.mollie_subscription_id, 'cst_1', 2000)
    await ingestion.ingestProviderPayment(subId, chargeId)
    const first = await sub(subId)
    await ingestion.ingestProviderPayment(subId, chargeId)
    const second = await sub(subId)

    expect(second.current_period_end).toEqual(first.current_period_end)
    expect(await notifCount(seed.userA.id, 'billing-renewed')).toBe(1)
  })

  it('drops to past_due when the renewal charge fails', async () => {
    const { subId } = await convert()
    const row = await sub(subId)
    const chargeId = fake.addRecurringCharge(row.mollie_subscription_id, 'cst_1', 2000, { status: 'open' })
    fake.settlePayment(chargeId, 'failed')
    await ingestion.ingestProviderPayment(subId, chargeId)

    const after = await sub(subId)
    expect(after.status).toBe('past_due')
    expect(after.past_due_since).not.toBeNull()
  })
})

// The subscription id ingestion routes on comes from an UNAUTHENTICATED webhook
// query parameter, so a real payment id can be posted against someone else's
// subscription. Each binding below is what stops that from buying a period.
describe('webhook payment binding', () => {
  it('refuses a payment whose metadata names another subscription', async () => {
    const { subId } = await convert()
    const victim = await sub(subId)

    const attacker = await billing.createSubscription({
      userId: seed.userB.id, status: 'trialing', total_cents: 2000,
      trial_ends_at: billing.daysFromNow(20),
      current_period_start: null, current_period_end: null,
    })
    // Isolate the metadata binding by giving the attacker the SAME provider
    // customer, so the customer check cannot be what rejects the payment.
    await pool.query('UPDATE users SET mollie_customer_id = $2 WHERE id = $1', [seed.userB.id, 'cst_1'])

    const chargeId = fake.addRecurringCharge(victim.mollie_subscription_id, 'cst_1', 2000, {
      metadata: { subscriptionId: String(subId), purpose: 'schedule' },
    })
    await ingestion.ingestProviderPayment(attacker.id, chargeId)

    const attacked = await sub(attacker.id)
    expect(attacked.status).toBe('trialing')
    expect(attacked.current_period_start).toBeNull()
    const untouched = await sub(subId)
    expect(untouched.current_period_start).toEqual(victim.current_period_start)
    expect(untouched.current_period_end).toEqual(victim.current_period_end)
    expect(await paymentRow(chargeId)).toBeNull()
  })

  it('refuses a genuine payment routed at a trialing subscription with no provider customer', async () => {
    const { subId } = await convert()
    const victim = await sub(subId)

    // The exact population the old `customerId && payment.customerId` guard
    // skipped: no Mollie customer exists until a trial converts.
    const trial = await billingSvc.startTrial(pool, userB(), { audience: 'band' })
    const { rows } = await pool.query(
      'SELECT mollie_customer_id FROM users WHERE id = $1', [seed.userB.id])
    expect(rows[0].mollie_customer_id).toBeNull()

    const chargeId = fake.addRecurringCharge(victim.mollie_subscription_id, 'cst_1', 2000)
    await ingestion.ingestProviderPayment(trial.subscription.id, chargeId)

    const attacked = await sub(trial.subscription.id)
    expect(attacked.status).toBe('trialing')
    expect(attacked.current_period_start).toBeNull()
    expect(attacked.last_charge_at).toBeNull()
    expect(await paymentRow(chargeId)).toBeNull()
  })

  // Re-pricing moves next_total_cents before repairSchedule has recreated the
  // remote schedule, so a charge already in flight at the old amount is genuine.
  it('still accepts a renewal charged at what the period just ending cost', async () => {
    const { subId } = await convert()
    const row = await sub(subId)
    await pool.query(
      `UPDATE subscriptions SET current_period_start = $2, current_period_end = $3,
              next_total_cents = 2500
        WHERE id = $1`,
      [subId, new Date(Date.now() - 40 * 86400000), new Date(Date.now() - 10 * 86400000)])

    const chargeId = fake.addRecurringCharge(row.mollie_subscription_id, 'cst_1', 2000)
    await ingestion.ingestProviderPayment(subId, chargeId)

    const after = await sub(subId)
    expect(after.status).toBe('active')
    expect(new Date(after.current_period_end).getTime()).toBeGreaterThan(Date.now())
    expect(await notifCount(seed.userA.id, 'billing-renewed')).toBe(1)
  })

  it('refuses a paid recurring charge for an amount the cycle does not owe', async () => {
    const { subId } = await convert()
    const row = await sub(subId)
    await pool.query('UPDATE subscriptions SET current_period_start = $2, current_period_end = $3 WHERE id = $1',
      [subId, new Date(Date.now() - 40 * 86400000), new Date(Date.now() - 10 * 86400000)])
    const aged = await sub(subId)

    const chargeId = fake.addRecurringCharge(row.mollie_subscription_id, 'cst_1', 1)
    await ingestion.ingestProviderPayment(subId, chargeId)

    const after = await sub(subId)
    expect(after.current_period_start).toEqual(aged.current_period_start)
    expect(after.current_period_end).toEqual(aged.current_period_end)
    expect(await paymentRow(chargeId)).toBeNull()
    expect(await notifCount(seed.userA.id, 'billing-renewed')).toBe(0)
  })
})

describe('cancel and resume', () => {
  it('cancels at period end while a paid period remains', async () => {
    const { subId } = await convert()
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id, {})
    expect(res).toMatchObject({ canceled: true, atPeriodEnd: true })
    expect((await sub(subId)).cancel_at_period_end).toBe(true)
  })

  it('cancels a trial immediately — nothing has been paid for', async () => {
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id, {})
    expect(res).toMatchObject({ canceled: true, atPeriodEnd: false })
    expect((await sub(trial.subscription.id)).status).toBe('canceled')
  })

  it('resumes and marks the schedule for recreation', async () => {
    const { subId } = await convert()
    await billingSvc.cancelSubscription(pool, seed.userA.id, {})
    const res = await billingSvc.resumeSubscription(pool, seed.userA.id)
    expect(res).toEqual({ resumed: true })
    expect((await sub(subId)).cancel_at_period_end).toBe(false)
  })
})

describe('the read model', () => {
  it('reports the subscription, its modules and the price snapshot', async () => {
    const { subId } = await convert({ second: 'artist' })
    const state = await billingSvc.getBillingState(pool, seed.userA.id)

    expect(state.subscription.id).toBe(subId)
    expect(state.subscription.status).toBe('active')
    expect(state.subscription.totalCents).toBe(3000)
    expect(state.subscription.modules.map((m) => m.audience).sort()).toEqual(['artist', 'band'])
    expect(state.trialAvailable).toBe(false)
    expect(state.plans.length).toBeGreaterThan(0)
  })

  it('offers the trial to a customer who has none', async () => {
    const state = await billingSvc.getBillingState(pool, seed.userA.id)
    expect(state.subscription).toBeNull()
    expect(state.trialAvailable).toBe(true)
    expect(state.trialDays).toBe(30)
  })
})
