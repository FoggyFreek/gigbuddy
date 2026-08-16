import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

// The reconciliation tasks, called directly. Every one of them is REPAIR-ONLY:
// access is enforced by the resolver on read, so these only flip durable status,
// finish sagas and clean up. The renewal notice is the single exception — it is
// a message, not a state change.
let pool, runMigrations, truncateAll, seedTwoTenants, billing
let tasks, adminSvc, providerFactory
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billing = await import('./_billing.js')
  tasks = await import('../../../server/commerce/billing/jobs/billingTasks.js')
  adminSvc = await import('../../../server/admin/subscriptions/adminSubscriptionService.js')
  providerFactory = await import('../../../server/commerce/billing/paymentProvider/providerFactory.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 2000, yearly_price_cents = 20000 WHERE slug = 'gold'")
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 1000, yearly_price_cents = 10000 WHERE slug = 'artist_gold'")
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
async function notifBodies(userId, type) {
  const { rows } = await pool.query(
    'SELECT body FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY id', [userId, type])
  return rows.map((r) => r.body)
}

describe('reconcileStaleSignups', () => {
  it('cancels a pending_activation whose first charge never settled', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id,
      status: 'pending_activation',
      pending_activation_at: daysFromNow(-8),
    })
    await tasks.reconcileStaleSignups(pool)
    const row = await status(sub.id)
    expect(row.status).toBe('canceled')
    expect(row.cancel_reason).toBe('payment_failed')
  })

  it('leaves one alone while a charge is still in flight (SEPA)', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id,
      status: 'pending_activation',
      pending_activation_at: daysFromNow(-8),
    })
    await billing.createSubscriptionPayment(sub.id, { status: 'pending', kind: 'conversion' })
    await tasks.reconcileStaleSignups(pool)
    expect((await status(sub.id)).status).toBe('pending_activation')
  })
})

describe('reconcileExpiredTrials', () => {
  it('cancels a trial that ran out without converting, past the grace', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id,
      status: 'trialing',
      trial_ends_at: daysFromNow(-3),
      current_period_start: null,
      current_period_end: null,
    })
    await tasks.reconcileExpiredTrials(pool)
    const row = await status(sub.id)
    expect(row.status).toBe('canceled')
    expect(row.cancel_reason).toBe('trial_abandoned')
    // The canceled row is what keeps the once-per-user trial spent.
    const repo = await import('../../../server/commerce/billing/subscriptionRepository.js')
    expect(await repo.hasUsedTrial(pool, seed.userA.id)).toBe(true)
  })

  it('leaves a trial inside the grace window alone', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id,
      status: 'trialing',
      trial_ends_at: daysFromNow(-1),
      current_period_start: null,
      current_period_end: null,
    })
    await tasks.reconcileExpiredTrials(pool)
    expect((await status(sub.id)).status).toBe('trialing')
  })
})

describe('reconcileRenewalNotices', () => {
  async function renewingIn(days, { totalCents = 2000 } = {}) {
    return billing.createSubscription({
      userId: seed.userA.id,
      current_period_start: daysFromNow(-30 + days),
      current_period_end: daysFromNow(days),
      total_cents: totalCents,
      next_total_cents: totalCents,
    })
  }

  it('notifies at T-7 with the date and the amount', async () => {
    const sub = await renewingIn(5)
    await tasks.reconcileRenewalNotices(pool)

    expect(await notifCount(seed.userA.id, 'billing-renewal-upcoming')).toBe(1)
    const [body] = await notifBodies(seed.userA.id, 'billing-renewal-upcoming')
    const expectedDate = new Date((await status(sub.id)).current_period_end).toISOString().slice(0, 10)
    expect(body).toContain(expectedDate)
    expect(body).toContain('€20.00')
    // Deliberately date-based, never "in 7 days": the sweep window is wide, so a
    // relative number would simply be wrong for most of the rows it catches.
    expect(body).not.toMatch(/in \d+ days/)
  })

  it('sends the T-7 notice once, however often the tick runs', async () => {
    await renewingIn(5)
    await tasks.reconcileRenewalNotices(pool)
    await tasks.reconcileRenewalNotices(pool)
    await tasks.reconcileRenewalNotices(pool)
    expect(await notifCount(seed.userA.id, 'billing-renewal-upcoming')).toBe(1)
  })

  it('sends a SECOND, distinct notice inside the last day', async () => {
    const sub = await renewingIn(5)
    await tasks.reconcileRenewalNotices(pool)
    await pool.query('UPDATE subscriptions SET current_period_end = $2 WHERE id = $1',
      [sub.id, daysFromNow(0.5)])
    await tasks.reconcileRenewalNotices(pool)
    expect(await notifCount(seed.userA.id, 'billing-renewal-upcoming')).toBe(2)
  })

  it('quotes the NEXT period price, not the current one', async () => {
    await renewingIn(3, { totalCents: 2000 })
    await pool.query('UPDATE subscriptions SET next_total_cents = 2700 WHERE user_id = $1', [seed.userA.id])
    await tasks.reconcileRenewalNotices(pool)
    const [body] = await notifBodies(seed.userA.id, 'billing-renewal-upcoming')
    expect(body).toContain('€27.00')
  })

  it('says nothing about a subscription that is cancelling', async () => {
    const sub = await renewingIn(3)
    await pool.query('UPDATE subscriptions SET cancel_at_period_end = TRUE WHERE id = $1', [sub.id])
    await tasks.reconcileRenewalNotices(pool)
    expect(await notifCount(seed.userA.id, 'billing-renewal-upcoming')).toBe(0)
  })

  it('says nothing about a renewal further out than the window', async () => {
    await renewingIn(20)
    await tasks.reconcileRenewalNotices(pool)
    expect(await notifCount(seed.userA.id, 'billing-renewal-upcoming')).toBe(0)
  })
})

describe('reconcileNextPeriodPricing', () => {
  it('re-prices the next renewal when a temporary discount lapses', async () => {
    // A promo that ended yesterday. Without this sweep the provider schedule
    // would keep charging the promotional amount forever.
    await pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent, effective_to)
       VALUES ('spring_promo', 1, 'Spring', 'percentage', 25, $1)`,
      [daysFromNow(-1)],
    )
    const sub = await billing.createSubscription({
      userId: seed.userA.id, total_cents: 1500, next_total_cents: 1500,
      mollie_mandate_id: 'mdt_x',
    })

    await tasks.reconcileNextPeriodPricing(pool)

    const row = await status(sub.id)
    expect(row.next_total_cents).toBe(2000) // full gold price again
    expect(row.mollie_schedule_stale).toBe(true)
  })

  it('applies a discount that has just STARTED', async () => {
    await pool.query(
      `INSERT INTO pricing_rules (code, version, name, discount_type, percent, effective_from)
       VALUES ('now_on', 1, 'Now on', 'percentage', 25, $1)`,
      [daysFromNow(-1)],
    )
    const sub = await billing.createSubscription({
      userId: seed.userA.id, total_cents: 2000, next_total_cents: 2000,
    })
    await tasks.reconcileNextPeriodPricing(pool)
    expect((await status(sub.id)).next_total_cents).toBe(1500)
  })

  it('is a no-op when the price has not moved', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id, total_cents: 2000, next_total_cents: 2000,
    })
    await tasks.reconcileNextPeriodPricing(pool)
    const row = await status(sub.id)
    expect(row.next_total_cents).toBe(2000)
    expect(row.mollie_schedule_stale).toBe(false)
  })

  it('prices the next period on the plan a scheduled downgrade lands on', async () => {
    await pool.query("UPDATE subscription_plans SET monthly_price_cents = 900 WHERE slug = 'silver'")
    const sub = await billing.createSubscription({ userId: seed.userA.id, total_cents: 2000 })
    const silver = await pool.query("SELECT id FROM subscription_plans WHERE slug = 'silver'")
    await pool.query(
      `UPDATE subscription_modules
          SET pending_plan_id = $2, pending_change_kind = 'downgrade', pending_price_cents = 900
        WHERE subscription_id = $1`,
      [sub.id, silver.rows[0].id],
    )
    await tasks.reconcileNextPeriodPricing(pool)
    expect((await status(sub.id)).next_total_cents).toBe(900)
  })

  it('prices a scheduled removal out of the next period entirely', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id,
      modules: [
        { planSlug: 'gold' },
        { planSlug: 'artist_gold', status: 'pending_removal', pending_change_kind: 'remove' },
      ],
      total_cents: 3000,
    })
    await tasks.reconcileNextPeriodPricing(pool)
    expect((await status(sub.id)).next_total_cents).toBe(2000)
  })
})

describe('reconcileCancelAtPeriodEnd', () => {
  it('finalizes a cancel whose period has passed', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id,
      cancel_at_period_end: true,
      cancel_reason: 'user_requested',
      current_period_end: daysFromNow(-1),
    })
    await tasks.reconcileCancelAtPeriodEnd(pool)
    expect((await status(sub.id)).status).toBe('canceled')
    expect(await notifCount(seed.userA.id, 'billing-canceled')).toBe(1)
  })

  it('leaves a cancel whose period is still running', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id, cancel_at_period_end: true, current_period_end: daysFromNow(5),
    })
    await tasks.reconcileCancelAtPeriodEnd(pool)
    expect((await status(sub.id)).status).toBe('active')
  })
})

describe('reconcilePastDue', () => {
  it('force-cancels past the retry grace', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id, status: 'past_due', past_due_since: daysFromNow(-15),
    })
    await tasks.reconcilePastDue(pool)
    expect((await status(sub.id)).status).toBe('canceled')
    expect(await notifCount(seed.userA.id, 'billing-canceled')).toBe(1)
  })

  it('waits inside the grace — Mollie is still retrying', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id, status: 'past_due', past_due_since: daysFromNow(-3),
    })
    await tasks.reconcilePastDue(pool)
    expect((await status(sub.id)).status).toBe('past_due')
  })
})

describe('reconcileTrialReminders', () => {
  it('sends one T-2d reminder and stamps it', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id, status: 'trialing', trial_ends_at: daysFromNow(1),
    })
    await tasks.reconcileTrialReminders(pool)
    await tasks.reconcileTrialReminders(pool)
    expect(await notifCount(seed.userA.id, 'billing-trial-ending')).toBe(1)
    expect((await status(sub.id)).trial_reminder_sent_at).not.toBeNull()
  })
})

describe('complimentary subscriptions', () => {
  it('grants, then revokes on expiry', async () => {
    const { rows } = await pool.query("SELECT id FROM subscription_plans WHERE slug = 'gold'")
    const grant = await adminSvc.grantComplimentary(pool, {
      userId: seed.userB.id, planId: rows[0].id, expiresAt: daysFromNow(-1).toISOString(),
    })
    expect(grant.error).toBeUndefined()

    await tasks.reconcileExpiredComplimentary(pool)
    expect((await status(grant.subscription.id)).status).toBe('canceled')
    expect(await notifCount(seed.userB.id, 'billing-canceled')).toBe(1)
  })

  it('is excluded from re-pricing — it has no price to keep in step', async () => {
    const { rows } = await pool.query("SELECT id FROM subscription_plans WHERE slug = 'gold'")
    const grant = await adminSvc.grantComplimentary(pool, { userId: seed.userB.id, planId: rows[0].id })
    await tasks.reconcileNextPeriodPricing(pool)
    expect((await status(grant.subscription.id)).next_total_cents).toBeNull()
  })
})

describe('the task registry', () => {
  it('runs every task without throwing on an empty database', async () => {
    for (const [name, task] of tasks.BILLING_TASKS) {
      await expect(task(pool), `task ${name} threw`).resolves.not.toThrow()
    }
  })
})
