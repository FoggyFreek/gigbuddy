// Data-access helpers for the subscription plan catalog. Plans are global
// (platform-level), not tenant-scoped — access control is the super-admin gate
// on the routes. Each query takes an `executor` (pool or transaction client).

export async function listPlans(executor) {
  const { rows } = await executor.query(
    'SELECT * FROM subscription_plans ORDER BY sort_order ASC, id ASC',
  )
  return rows
}

export async function fetchPlan(executor, planId) {
  const { rows } = await executor.query(
    'SELECT * FROM subscription_plans WHERE id = $1',
    [planId],
  )
  return rows[0] ?? null
}

export async function fetchFallbackPlan(executor) {
  const { rows } = await executor.query(
    'SELECT * FROM subscription_plans WHERE is_fallback LIMIT 1',
  )
  return rows[0] ?? null
}

export async function insertPlan(executor, plan) {
  const { rows } = await executor.query(
    `INSERT INTO subscription_plans
       (slug, name, monthly_price_cents, yearly_price_cents, entitlements, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      plan.slug,
      plan.name,
      plan.monthly_price_cents,
      plan.yearly_price_cents,
      plan.entitlements,
      plan.is_active,
      plan.sort_order,
    ],
  )
  return rows[0]
}

export async function updatePlanFields(executor, planId, fields, values) {
  const { rows } = await executor.query(
    `UPDATE subscription_plans
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length + 1}
     RETURNING *`,
    [...values, planId],
  )
  return rows[0] ?? null
}

export async function deletePlan(executor, planId) {
  const { rowCount } = await executor.query(
    'DELETE FROM subscription_plans WHERE id = $1',
    [planId],
  )
  return rowCount > 0
}
