// Data-access helpers for the subscription plan catalog. Plans are global
// (platform-level), not tenant-scoped — access control is the super-admin gate
// on the routes. Each query takes an `executor` (pool or transaction client).

// Grouped by ladder, then ranked within it — sort_order is only meaningful
// inside an audience now, so a flat sort would interleave the two products.
// Band first: it is the primary catalog, and an explicit CASE says so rather
// than relying on 'band' > 'artist' alphabetically.
export async function listPlans(executor) {
  const { rows } = await executor.query(
    `SELECT * FROM subscription_plans
      ORDER BY CASE audience WHEN 'band' THEN 0 ELSE 1 END, sort_order ASC, id ASC`,
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

// Each ladder has its own free floor, so the audience is required: an
// audience-blind lookup would hand a band tenant the artist floor, or vice
// versa. Guaranteed unique by subscription_plans_single_fallback_per_audience_idx.
export async function fetchFallbackPlan(executor, audience) {
  const { rows } = await executor.query(
    'SELECT * FROM subscription_plans WHERE is_fallback AND audience = $1',
    [audience],
  )
  return rows[0] ?? null
}

// The plan a free trial grants on this ladder. Flag-driven, never slug-driven:
// slugs are admin-editable and have already drifted in the field, and guessing
// wrong here would hand a trialling customer the wrong product.
// Guaranteed unique by subscription_plans_single_trial_tier_per_audience_idx.
export async function fetchTrialTierPlan(executor, audience) {
  const { rows } = await executor.query(
    'SELECT * FROM subscription_plans WHERE is_trial_tier AND is_active AND audience = $1',
    [audience],
  )
  return rows[0] ?? null
}

export async function insertPlan(executor, plan) {
  const { rows } = await executor.query(
    `INSERT INTO subscription_plans
       (slug, name, audience, monthly_price_cents, yearly_price_cents, entitlements, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      plan.slug,
      plan.name,
      plan.audience,
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
