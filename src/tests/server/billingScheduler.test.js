import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

let pool, runMigrations, truncateAll, seedTwoTenants, billingHelpers
let tasks, adminSvc, providerFactory
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billingHelpers = await import('./_billing.js')
  tasks = await import('../../../server/jobs/billingTasks.js')
  adminSvc = await import('../../../server/services/adminSubscriptionService.js')
  providerFactory = await import('../../../server/billing/paymentProvider/index.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  fake = new FakeProvider()
  providerFactory.setPaymentProviderForTests(fake)
})

afterAll(async () => {
  providerFactory.resetPaymentProvider()
  await pool.end()
})

const { daysFromNow } = await import('./_billing.js')

async function status(subId) {
  const { rows } = await pool.query('SELECT * FROM subscriptions WHERE id = $1', [subId])
  return rows[0]
}
async function notifCount(userId, type) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int n FROM notifications WHERE user_id = $1 AND type = $2', [userId, type])
  return rows[0].n
}

describe('reconcileStaleSignups', () => {
  it('cancels a pending_mandate older than 24h', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'silver', status: 'pending_mandate',
      price_cents: 999, current_period_start: null, current_period_end: null,
      created_at: daysFromNow(-2),
    })
    await tasks.reconcileStaleSignups(pool)
    const row = await status(s.id)
    expect(row.status).toBe('canceled')
    expect(row.cancel_reason).toBe('trial_abandoned')
  })

  it('cancels a pending_activation older than 7d with nothing in flight', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'silver', status: 'pending_activation',
      price_cents: 999, current_period_start: null, current_period_end: null,
      created_at: daysFromNow(-8),
    })
    await tasks.reconcileStaleSignups(pool)
    expect((await status(s.id)).status).toBe('canceled')
  })

  it('leaves a pending_activation with an in-flight payment alone', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'silver', status: 'pending_activation',
      price_cents: 999, current_period_start: null, current_period_end: null,
      created_at: daysFromNow(-8),
    })
    await billingHelpers.createSubscriptionPayment(s.id, { status: 'pending', kind: 'recurring' })
    await tasks.reconcileStaleSignups(pool)
    expect((await status(s.id)).status).toBe('pending_activation')
  })
})

describe('reconcileCancelAtPeriodEnd', () => {
  it('finalizes a cancel-at-period-end whose period has passed', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'silver', status: 'active',
      cancel_at_period_end: true, cancel_reason: 'user_requested',
      current_period_start: daysFromNow(-40), current_period_end: daysFromNow(-1),
    })
    await tasks.reconcileCancelAtPeriodEnd(pool)
    const row = await status(s.id)
    expect(row.status).toBe('canceled')
    expect(await notifCount(seed.userA.id, 'billing-canceled')).toBe(1)
  })

  it('leaves a cancel-at-period-end still within its period', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'silver', status: 'active',
      cancel_at_period_end: true, cancel_reason: 'user_requested',
      current_period_end: daysFromNow(5),
    })
    await tasks.reconcileCancelAtPeriodEnd(pool)
    expect((await status(s.id)).status).toBe('active')
  })
})

describe('reconcileTrialReminders', () => {
  it('sends one T-2d reminder and stamps it', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'silver', status: 'trialing',
      trial_ends_at: daysFromNow(1), current_period_start: null, current_period_end: null,
    })
    await tasks.reconcileTrialReminders(pool)
    await tasks.reconcileTrialReminders(pool) // must not double-fire
    expect(await notifCount(seed.userA.id, 'billing-trial-ending')).toBe(1)
    expect((await status(s.id)).trial_reminder_sent_at).not.toBeNull()
  })
})

describe('reconcilePastDue', () => {
  it('force-cancels a past_due beyond the 14d grace and cancels the schedule', async () => {
    fake.subscriptions.set('sub_x', { id: 'sub_x', status: 'active' })
    await pool.query('UPDATE users SET mollie_customer_id = $2 WHERE id = $1', [seed.userA.id, 'cst_1'])
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'silver', status: 'past_due',
      past_due_since: daysFromNow(-15), mollie_subscription_id: 'sub_x',
    })
    await tasks.reconcilePastDue(pool)
    expect((await status(s.id)).status).toBe('canceled')
    expect(fake.subscriptions.get('sub_x').status).toBe('canceled')
    expect(await notifCount(seed.userA.id, 'billing-canceled')).toBe(1)
  })
})

describe('complimentary (admin)', () => {
  it('grants, blocks self-management implicitly, and revokes', async () => {
    const { rows: [plan] } = await pool.query("SELECT id FROM subscription_plans WHERE slug = 'gold'")
    const grant = await adminSvc.grantComplimentary(pool, { userId: seed.userB.id, planId: plan.id })
    expect(grant.subscription.isComplimentary).toBe(true)
    expect(grant.subscription.status).toBe('active')
    expect(await notifCount(seed.userB.id, 'billing-complimentary-granted')).toBe(1)

    const revoke = await adminSvc.revokeComplimentary(pool, seed.userB.id)
    expect(revoke.revoked).toBe(true)
    const { rows } = await pool.query(
      "SELECT status, cancel_reason FROM subscriptions WHERE user_id = $1", [seed.userB.id])
    expect(rows[0].status).toBe('canceled')
    expect(rows[0].cancel_reason).toBe('admin_revoked')
  })

  it('expires a complimentary subscription past its expiry', async () => {
    const { rows: [plan] } = await pool.query("SELECT id FROM subscription_plans WHERE slug = 'gold'")
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', status: 'active',
      is_complimentary: true, price_cents: 0,
      complimentary_expires_at: daysFromNow(-1),
      current_period_start: null, current_period_end: null, plan_id: plan.id,
    })
    await tasks.reconcileExpiredComplimentary(pool)
    expect((await status(s.id)).status).toBe('canceled')
    expect(await notifCount(seed.userA.id, 'billing-canceled')).toBe(1)
  })
})
