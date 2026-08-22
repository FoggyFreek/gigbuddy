import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createSubscription, createSubscriptionPayment } from './_billing.js'
import { FakeProvider } from './_fakeProvider.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants, providerFactory
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  providerFactory = await import('../../../server/commerce/billing/paymentProvider/providerFactory.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  fake = new FakeProvider()
  providerFactory.setPaymentProviderForTests(fake)
})

afterAll(async () => {
  providerFactory.resetPaymentProvider()
  await pool.end()
})

function as(userId, tenantId) {
  return (req) => req
    .set('x-test-user-id', String(userId))
    .set('x-test-tenant-id', String(tenantId))
}

const asUser = (req) => as(seed.userA.id, seed.tenantA.id)(req)
const asSuper = (req) => as(seed.superUser.id, seed.tenantA.id)(req)

async function seedAlerts() {
  const subscription = await createSubscription({
    userId: seed.userA.id,
    mollie_schedule_stale: true,
    billing_repair_needed: true,
  })
  await createSubscriptionPayment(subscription.id, {
    status: 'pending',
    updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
  })

  await pool.query(
    `INSERT INTO billing_operations
       (user_id, subscription_id, op_type, idempotency_key, status, attempt_count,
        command_payload, next_attempt_at, created_at, updated_at)
     VALUES
       ($1, $2, 'create_refund', 'terminal-op', 'failed_terminal', 2,
        '{}'::jsonb, NOW(), NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours'),
       ($1, $2, 'create_schedule', 'retry-op', 'failed_retryable', 3,
        '{}'::jsonb, NOW() + INTERVAL '5 minutes', NOW() - INTERVAL '2 hours', NOW())`,
    [seed.userA.id, subscription.id],
  )

  await pool.query(
    `INSERT INTO billing_webhook_events
       (subscription_id, provider_payment_id, status, error_code, received_at, processed_at)
     VALUES
       ($1, 'tr_unresolved', 'failed', 'provider_error', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'),
       ($1, 'tr_recovered', 'failed', 'timeout', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'),
       ($1, 'tr_recovered', 'processed', NULL, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`,
    [subscription.id],
  )
  return subscription
}

describe('super-admin operations dashboard', () => {
  it('rejects regular users on every operations endpoint', async () => {
    for (const path of ['summary', 'billing-operations', 'webhook-failures', 'status-drift']) {
      await asUser(request(app).get(`/api/admin/operations/${path}`)).expect(403)
    }
  })

  it('summarizes actionable billing and webhook health', async () => {
    await seedAlerts()

    const res = await asSuper(request(app).get('/api/admin/operations/summary')).expect(200)
    expect(res.body).toMatchObject({
      terminalOperations: 1,
      retryingOperations: 1,
      unresolvedWebhookFailures: 1,
      statusDrift: 1,
    })
    expect(res.body.oldestPendingAt).toEqual(expect.any(String))
  })

  it('returns bounded alert feeds and rejects malformed limits', async () => {
    const subscription = await seedAlerts()

    const operations = await asSuper(
      request(app).get('/api/admin/operations/billing-operations?limit=1'),
    ).expect(200)
    expect(operations.body.meta).toEqual({ limit: 1, returned: 1 })
    expect(operations.body.items[0]).toMatchObject({
      subscriptionId: subscription.id,
      status: 'failed_terminal',
      attemptCount: 2,
    })

    const webhooks = await asSuper(
      request(app).get('/api/admin/operations/webhook-failures?limit=10'),
    ).expect(200)
    expect(webhooks.body.meta).toEqual({ limit: 10, returned: 1 })
    expect(webhooks.body.items[0]).toMatchObject({ providerPaymentId: 'tr_unresolved' })

    const drift = await asSuper(
      request(app).get('/api/admin/operations/status-drift?limit=10'),
    ).expect(200)
    expect(drift.body.meta).toEqual({ limit: 10, returned: 1 })
    expect(drift.body.items[0]).toMatchObject({
      subscriptionId: subscription.id,
      scheduleStale: true,
      repairNeeded: true,
      stalePayment: true,
    })

    await asSuper(request(app).get('/api/admin/operations/status-drift?limit=0')).expect(400)
    await asSuper(request(app).get('/api/admin/operations/status-drift?limit=101')).expect(400)
  })

  it('persists webhook processing failures even though Mollie receives 200', async () => {
    const subscription = await createSubscription({ userId: seed.userA.id })

    await request(app)
      .post(`/api/public/billing/mollie/webhook?subscription=${subscription.id}`)
      .type('form')
      .send({ id: 'tr_missing' })
      .expect(200)

    const { rows } = await pool.query(
      `SELECT subscription_id, provider_payment_id, status, error_code
         FROM billing_webhook_events`,
    )
    expect(rows).toEqual([expect.objectContaining({
      subscription_id: subscription.id,
      provider_payment_id: 'tr_missing',
      status: 'failed',
      error_code: 'not_found',
    })])
  })
})
