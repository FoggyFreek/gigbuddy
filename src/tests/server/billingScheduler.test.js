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

describe('downgrade scheduler tasks (phase 6)', () => {
  async function planIdOf(slug) {
    const { rows } = await pool.query('SELECT id FROM subscription_plans WHERE slug = $1', [slug])
    return rows[0].id
  }

  it('stale pending_activation ages from pending_activation_at, not created_at', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'silver', status: 'pending_activation',
      price_cents: 999, current_period_start: null, current_period_end: null,
      created_at: daysFromNow(-30), pending_activation_at: daysFromNow(-1),
    })
    await tasks.reconcileStaleSignups(pool)
    expect((await status(s.id)).status).toBe('pending_activation') // flipped only yesterday
  })

  it('reconcileDowngradeSchedules resumes the cancel-old/create-replacement saga', async () => {
    fake.subscriptions.set('sub_old', { id: 'sub_old', status: 'active', nextPaymentDate: null })
    await pool.query('UPDATE users SET mollie_customer_id = $2 WHERE id = $1', [seed.userA.id, 'cst_1'])
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', status: 'active', price_cents: 1999,
      mollie_mandate_id: 'mdt_1', mollie_subscription_id: 'sub_old',
      pending_plan_id: await planIdOf('silver'), pending_change_kind: 'downgrade',
      pending_billing_interval: 'month', pending_price_cents: 999,
      downgrade_schedule_pending: true, superseded_mollie_subscription_id: 'sub_old',
      pending_purge_manifest: { features: ['chordpro'] }, pending_limits_snapshot: { storage_mb: 150 },
    })
    await tasks.reconcileDowngradeSchedules(pool)
    const row = await status(s.id)
    expect(fake.subscriptions.get('sub_old').status).toBe('canceled')
    expect(row.downgrade_schedule_pending).toBe(false)
    expect(row.superseded_mollie_subscription_id).toBeNull()
    expect(row.mollie_subscription_id).not.toBe('sub_old')
    expect(fake.subscriptions.get(row.mollie_subscription_id).status).toBe('active')
  })

  it('a provider-canceled replacement finalizes the downgrade without purging', async () => {
    fake.subscriptions.set('sub_repl', { id: 'sub_repl', status: 'canceled', nextPaymentDate: null })
    await pool.query('UPDATE users SET mollie_customer_id = $2 WHERE id = $1', [seed.userA.id, 'cst_1'])
    await pool.query('UPDATE tenants SET owner_user_id = $1 WHERE id = $2', [seed.userA.id, seed.tenantA.id])
    const { rows: [song] } = await pool.query(
      'INSERT INTO songs (tenant_id, title) VALUES ($1, $2) RETURNING id', [seed.tenantA.id, 'S'])
    await pool.query(
      "INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source) VALUES ($1, $2, 'C', '{t}')",
      [song.id, seed.tenantA.id])
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', status: 'pending_activation', price_cents: 1999,
      mollie_mandate_id: 'mdt_1', mollie_subscription_id: 'sub_repl',
      pending_plan_id: await planIdOf('silver'), pending_change_kind: 'downgrade',
      pending_billing_interval: 'month', pending_price_cents: 999,
      pending_activation_at: daysFromNow(-1),
      pending_purge_manifest: { features: ['chordpro'] }, pending_limits_snapshot: { storage_mb: 150 },
    })
    await tasks.reconcileDowngradeSchedules(pool)
    const row = await status(s.id)
    expect(row.status).toBe('canceled')
    expect(row.cancel_reason).toBe('payment_failed')
    expect(row.pending_change_kind).toBeNull()
    expect(row.pending_purge_manifest).toBeNull()
    const { rows: [{ n }] } = await pool.query(
      'SELECT COUNT(*)::int n FROM song_chordpro_charts WHERE tenant_id = $1', [seed.tenantA.id])
    expect(n).toBe(1) // nothing purged
  })

  it('reconcilePendingDowngrades flips an expired pending downgrade without purging', async () => {
    await pool.query('UPDATE tenants SET owner_user_id = $1 WHERE id = $2', [seed.userA.id, seed.tenantA.id])
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', status: 'active', price_cents: 1999,
      current_period_start: daysFromNow(-40), current_period_end: daysFromNow(-1),
      pending_plan_id: await planIdOf('silver'), pending_change_kind: 'downgrade',
      pending_billing_interval: 'month', pending_price_cents: 999,
      pending_purge_manifest: { features: ['chordpro'] }, pending_limits_snapshot: { storage_mb: 150 },
    })
    await tasks.reconcilePendingDowngrades(pool)
    const row = await status(s.id)
    expect(row.status).toBe('pending_activation')
    expect(row.pending_activation_at).not.toBeNull()
    expect(row.pending_purge_manifest).not.toBeNull()
    expect(await notifCount(seed.userA.id, 'billing-downgrade-scheduled')).toBe(1)
  })

  it('reconcilePendingPurges executes a stranded manifest exactly once', async () => {
    await pool.query('UPDATE tenants SET owner_user_id = $1 WHERE id = $2', [seed.userA.id, seed.tenantA.id])
    const { rows: [song] } = await pool.query(
      'INSERT INTO songs (tenant_id, title) VALUES ($1, $2) RETURNING id', [seed.tenantA.id, 'S'])
    await pool.query(
      "INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source) VALUES ($1, $2, 'C', '{t}')",
      [song.id, seed.tenantA.id])
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', status: 'canceled', price_cents: 1999,
      canceled_at: new Date(), cancel_reason: 'user_requested',
      pending_purge_manifest: { features: ['chordpro'] }, pending_limits_snapshot: { storage_mb: 50 },
    })
    await tasks.reconcilePendingPurges(pool)
    await tasks.reconcilePendingPurges(pool) // idempotent — manifest consumed
    const row = await status(s.id)
    expect(row.pending_purge_manifest).toBeNull()
    const { rows: [{ n }] } = await pool.query(
      'SELECT COUNT(*)::int n FROM song_chordpro_charts WHERE tenant_id = $1', [seed.tenantA.id])
    expect(n).toBe(0)
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
