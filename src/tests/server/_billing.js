// Shared helpers for subscription/entitlement tests: tenant ownership and
// direct subscription rows (billing flows arrive in a later phase; tests
// craft subscription state directly).
import { pool } from './_db.js'

export function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

export async function setTenantOwner(tenantId, userId) {
  await pool.query('UPDATE tenants SET owner_user_id = $2 WHERE id = $1', [tenantId, userId])
}

export async function getPlanBySlug(slug) {
  const { rows } = await pool.query('SELECT * FROM subscription_plans WHERE slug = $1', [slug])
  return rows[0] ?? null
}

// Inserts a subscription row. Defaults: an active monthly gold subscription in
// the middle of its period. Any subscriptions column can be overridden.
export async function createSubscription({ userId, planSlug = 'gold', ...overrides }) {
  const plan = await getPlanBySlug(planSlug)
  const row = {
    user_id: userId,
    plan_id: plan.id,
    status: 'active',
    billing_interval: 'month',
    price_cents: 999,
    current_period_start: daysFromNow(-15),
    current_period_end: daysFromNow(15),
    ...overrides,
  }
  const cols = Object.keys(row)
  const placeholders = cols.map((_, i) => `$${i + 1}`)
  const { rows } = await pool.query(
    `INSERT INTO subscriptions (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    cols.map((c) => row[c]),
  )
  return rows[0]
}

let paymentSeq = 0

export async function createSubscriptionPayment(subscriptionId, overrides = {}) {
  const row = {
    subscription_id: subscriptionId,
    mollie_payment_id: `tr_test_${Date.now()}_${paymentSeq++}`,
    kind: 'recurring',
    amount_cents: 999,
    status: 'pending',
    mollie_created_at: new Date(),
    ...overrides,
  }
  const cols = Object.keys(row)
  const placeholders = cols.map((_, i) => `$${i + 1}`)
  const { rows } = await pool.query(
    `INSERT INTO subscription_payments (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    cols.map((c) => row[c]),
  )
  return rows[0]
}

// Cheapest possible finance-data row for financeReadOnly tests.
export async function createFinanceData(tenantId) {
  await pool.query(
    `INSERT INTO ledger_transactions (tenant_id, entry_date, source_type, source_id, source_event)
     VALUES ($1, CURRENT_DATE, 'invoice', 1, 'sent')`,
    [tenantId],
  )
}
