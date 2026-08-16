import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

// Refunds. Within five days of the charge that OPENED the current period,
// cancelling ends access immediately and refunds that charge in full; outside
// the window a cancellation runs to the period end with no refund. Super admins
// can grant partial refunds for support cases handled out of band.
let pool, runMigrations, truncateAll, seedTwoTenants, billing
let billingSvc, adminSvc, ingestion, entSvc, providerFactory
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billing = await import('./_billing.js')
  billingSvc = await import('../../../server/commerce/billing/billingService.js')
  adminSvc = await import('../../../server/admin/subscriptions/adminSubscriptionService.js')
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
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 2000, yearly_price_cents = 20000 WHERE slug = 'gold'")
  entSvc.clearEntitlementCaches()
  fake = new FakeProvider()
  providerFactory.setPaymentProviderForTests(fake)
})

afterAll(async () => {
  providerFactory.resetPaymentProvider()
  await pool.end()
})

const userA = () => ({ id: seed.userA.id, email: 'a@test.local', name: 'Alpha User' })

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
async function paymentRow(subId) {
  const { rows } = await pool.query(
    'SELECT * FROM subscription_payments WHERE subscription_id = $1 ORDER BY id DESC LIMIT 1', [subId])
  return rows[0]
}
async function refunds(subId) {
  const { rows } = await pool.query(
    'SELECT * FROM subscription_refunds WHERE subscription_id = $1 ORDER BY id', [subId])
  return rows
}
async function notifCount(userId, type) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int n FROM notifications WHERE user_id = $1 AND type = $2', [userId, type])
  return rows[0].n
}

// trial → checkout → the combined payment settles → an active subscription.
async function convert() {
  const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
  const subId = trial.subscription.id
  const checkout = await billingSvc.checkout(pool, userA(), { interval: 'month' })
  const verificationId = await paymentIdOf(subId, 'mandate_verification')
  fake.settlePayment(verificationId, 'paid')
  await ingestion.ingestProviderPayment(subId, verificationId)
  const scheduled = await subRow(subId)
  const payId = fake.addRecurringCharge(
    scheduled.mollie_subscription_id, `cst_${fake.custSeq}`, checkout.totalCents,
    { status: 'paid', paidAt: new Date() },
  )
  await ingestion.ingestProviderPayment(subId, payId)
  return subId
}

// Push the cycle-opening charge back in time to leave the refund window.
async function ageLastCharge(subId, days) {
  await pool.query(
    'UPDATE subscriptions SET last_charge_at = $2 WHERE id = $1',
    [subId, new Date(Date.now() - days * 86400000)],
  )
}

describe('the withdrawal window', () => {
  it('is reported on the read model while it is open', async () => {
    const subId = await convert()
    const state = await billingSvc.getBillingState(pool, seed.userA.id)
    expect(state.subscription.refundEligibleUntil).not.toBeNull()

    await ageLastCharge(subId, 6)
    const later = await billingSvc.getBillingState(pool, seed.userA.id)
    expect(later.subscription.refundEligibleUntil).toBeNull()
  })

  it('cancels immediately and refunds the charge in full', async () => {
    const subId = await convert()
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })

    expect(res).toMatchObject({ canceled: true, atPeriodEnd: false, refunded: true, refundAmountCents: 2000 })
    expect((await subRow(subId)).status).toBe('canceled')

    const [refund] = await refunds(subId)
    expect(refund).toMatchObject({ amount_cents: 2000, reason: 'withdrawal_window', status: 'succeeded' })
    expect(refund.requested_by_user_id).toBeNull() // the customer's own withdrawal
    expect(refund.mollie_refund_id).toBeTruthy()
  })

  it('ends access the moment it cancels — no period-end grace', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await convert()
    expect((await entSvc.resolveTenantEntitlements(pool, seed.tenantA.id)).locked).toBe(false)

    await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    entSvc.clearEntitlementCaches()

    const resolved = await entSvc.resolveTenantEntitlements(pool, seed.tenantA.id)
    expect(resolved.locked).toBe(true)
    expect(resolved.planSlug).toBe('bronze')
  })

  it('deletes nothing — a cancellation is a lapse, not a downgrade', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    const subId = await convert()
    const { rows: [song] } = await pool.query(
      "INSERT INTO songs (tenant_id, title) VALUES ($1, 'S') RETURNING id", [seed.tenantA.id])
    await pool.query(
      "INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source) VALUES ($1, $2, 'C', '{}')",
      [song.id, seed.tenantA.id])

    await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int n FROM song_chordpro_charts WHERE tenant_id = $1', [seed.tenantA.id])
    expect(rows[0].n).toBe(1)
    expect(subId).toBeTruthy()
  })

  it('cancels the provider schedule too', async () => {
    const subId = await convert()
    const providerSubId = (await subRow(subId)).mollie_subscription_id
    await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    expect(fake.subscriptions.get(providerSubId).status).toBe('canceled')
  })

  it('notifies the customer', async () => {
    await convert()
    await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    expect(await notifCount(seed.userA.id, 'billing-refunded')).toBe(1)
  })

  it('refuses once the window has closed', async () => {
    const subId = await convert()
    await ageLastCharge(subId, 6)

    const res = await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    expect(res.error.status).toBe(409)
    expect(res.error.body.code).toBe('refund_window_closed')
    expect((await subRow(subId)).status).toBe('active')
    expect(await refunds(subId)).toEqual([])
  })

  it('is open on the boundary day and shut just past it', async () => {
    const subId = await convert()
    await ageLastCharge(subId, 4.9)
    expect((await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })).canceled).toBe(true)

    await pool.query("UPDATE subscriptions SET status = 'active', canceled_at = NULL WHERE id = $1", [subId])
    await ageLastCharge(subId, 5.1)
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    expect(res.error.body.code).toBe('refund_window_closed')
  })

  it('refuses a trial — there is no charge to give back', async () => {
    await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    expect(res.error.body.code).toBe('refund_window_closed')
  })

  it('re-opens after a renewal charge', async () => {
    const subId = await convert()
    await ageLastCharge(subId, 6)
    const row = await subRow(subId)
    await pool.query(
      'UPDATE subscriptions SET current_period_start = $2, current_period_end = $3 WHERE id = $1',
      [subId, new Date(Date.now() - 40 * 86400000), new Date(Date.now() - 10 * 86400000)])

    const chargeId = fake.addRecurringCharge(row.mollie_subscription_id, 'cst_1', 2000)
    await ingestion.ingestProviderPayment(subId, chargeId)

    const res = await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    expect(res).toMatchObject({ canceled: true, refunded: true })
  })

  it('refuses a second refund of the same charge', async () => {
    const subId = await convert()
    await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    // The row is canceled, so there is no live subscription to cancel again.
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })
    expect(res.error.status).toBe(404)
    expect(await refunds(subId)).toHaveLength(1)
  })
})

describe('a refunded payment must not resurrect the subscription', () => {
  // Mollie reports a refund as a status change on the ORIGINAL payment. Ingesting
  // that after the cancellation would otherwise try to mark the row past_due.
  it('stays canceled when the refund lands back through ingestion', async () => {
    const subId = await convert()
    const payId = await paymentIdOf(subId, 'recurring')
    await billingSvc.cancelSubscription(pool, seed.userA.id, { immediate: true })

    fake.settlePayment(payId, 'refunded')
    await ingestion.ingestProviderPayment(subId, payId)

    const row = await subRow(subId)
    expect(row.status).toBe('canceled')
    expect(row.past_due_since).toBeNull()
  })
})

describe('super-admin partial refunds', () => {
  it('refunds part of a payment and leaves the subscription running', async () => {
    const subId = await convert()
    const payment = await paymentRow(subId)

    const res = await adminSvc.refundSubscription(pool, subId, {
      paymentId: payment.id, amountCents: 500, note: 'goodwill',
    }, seed.superUser.id)

    expect(res).toMatchObject({ refunded: true, amountCents: 500 })
    expect((await subRow(subId)).status).toBe('active')
    const [refund] = await refunds(subId)
    expect(refund).toMatchObject({
      amount_cents: 500, reason: 'admin_grant', note: 'goodwill',
      requested_by_user_id: seed.superUser.id, status: 'succeeded',
    })
  })

  it('allows repeated partial refunds up to the payment total', async () => {
    const subId = await convert()
    const payment = await paymentRow(subId)
    const grant = (amountCents) => adminSvc.refundSubscription(
      pool, subId, { paymentId: payment.id, amountCents }, seed.superUser.id)

    expect((await grant(1200)).refunded).toBe(true)
    expect((await grant(800)).refunded).toBe(true)
    expect(await refunds(subId)).toHaveLength(2)
  })

  it('refuses to refund more than the payment', async () => {
    const subId = await convert()
    const payment = await paymentRow(subId)
    await adminSvc.refundSubscription(pool, subId, {
      paymentId: payment.id, amountCents: 1800,
    }, seed.superUser.id)

    const res = await adminSvc.refundSubscription(pool, subId, {
      paymentId: payment.id, amountCents: 500,
    }, seed.superUser.id)
    expect(res.error.body.code).toBe('refund_exceeds_payment')
    expect(await refunds(subId)).toHaveLength(1)
  })

  it("refuses a payment belonging to somebody else's subscription", async () => {
    const subId = await convert()
    const payment = await paymentRow(subId)
    const other = await billing.createSubscription({ userId: seed.userB.id })

    const res = await adminSvc.refundSubscription(pool, other.id, {
      paymentId: payment.id, amountCents: 100,
    }, seed.superUser.id)
    expect(res.error.status).toBe(404)
    expect(await refunds(subId)).toEqual([])
  })

  it('refuses an unpaid payment', async () => {
    const subId = await convert()
    const payment = await paymentRow(subId)
    await pool.query("UPDATE subscription_payments SET status = 'open' WHERE id = $1", [payment.id])

    const res = await adminSvc.refundSubscription(pool, subId, {
      paymentId: payment.id, amountCents: 100,
    }, seed.superUser.id)
    expect(res.error.body.code).toBe('payment_not_refundable')
  })

  it('validates the request shape', async () => {
    const subId = await convert()
    const payment = await paymentRow(subId)
    expect((await adminSvc.refundSubscription(pool, subId, { paymentId: payment.id, amountCents: 0 }, 1)).error.status).toBe(400)
    expect((await adminSvc.refundSubscription(pool, subId, { paymentId: payment.id, amountCents: -5 }, 1)).error.status).toBe(400)
    expect((await adminSvc.refundSubscription(pool, subId, { amountCents: 100 }, 1)).error.status).toBe(400)
  })

  it('lists the refunds of a subscription for the operator', async () => {
    const subId = await convert()
    const payment = await paymentRow(subId)
    await adminSvc.refundSubscription(pool, subId, {
      paymentId: payment.id, amountCents: 300,
    }, seed.superUser.id)

    const listed = await adminSvc.listSubscriptionRefunds(pool, subId)
    expect(listed.refunds).toHaveLength(1)
    expect(listed.refunds[0].payment_kind).toBe('recurring')
  })
})

describe('a failed provider refund', () => {
  it('is recorded as failed and does not block a retry for the same amount', async () => {
    const subId = await convert()
    const payment = await paymentRow(subId)
    fake.failNextWith = { retryable: false }

    const first = await adminSvc.refundSubscription(pool, subId, {
      paymentId: payment.id, amountCents: 500,
    }, seed.superUser.id)
    expect(first.refunded).toBe(false)
    expect((await refunds(subId))[0].status).toBe('failed')

    // A failed refund never moved money, so it must not consume the payment's
    // remaining refundable balance.
    const second = await adminSvc.refundSubscription(pool, subId, {
      paymentId: payment.id, amountCents: 2000,
    }, seed.superUser.id)
    expect(second.refunded).toBe(true)
  })
})
