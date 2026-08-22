// Data access for the pricing rule catalog. Rules are global (platform-level),
// not tenant-scoped — access control is the super-admin gate on the routes.
// Every function takes an `executor` (pool or transaction client) first.

const COLUMNS = `
  code, version, name, discount_type, percent, amount_cents, combinable, is_active,
  effective_from, effective_to, required_audiences, min_module_count,
  billing_intervals, priority`

// Admin view: every version, grouped by code with the newest version first, so
// the live row of each code leads its own group.
export async function listPricingRules(executor) {
  const { rows } = await executor.query(
    'SELECT * FROM pricing_rules ORDER BY code ASC, version DESC',
  )
  return rows
}

// What the pricing engine quotes against. Ordering matches the engine's own
// tie-break so a DB-ordered list is already in application order.
export async function listActivePricingRules(executor) {
  const { rows } = await executor.query(
    'SELECT * FROM pricing_rules WHERE is_active ORDER BY priority ASC, code ASC',
  )
  return rows
}

export async function fetchPricingRule(executor, id) {
  const { rows } = await executor.query('SELECT * FROM pricing_rules WHERE id = $1', [id])
  return rows[0] ?? null
}

// Locks the whole code group so a concurrent version bump cannot pick the same
// next version number (the UNIQUE (code, version) index is the backstop).
export async function lockCodeGroup(executor, code) {
  const { rows } = await executor.query(
    'SELECT id, version, is_active FROM pricing_rules WHERE code = $1 ORDER BY version FOR UPDATE',
    [code],
  )
  return rows
}

export async function insertPricingRule(executor, rule) {
  const { rows } = await executor.query(
    `INSERT INTO pricing_rules (${COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      rule.code,
      rule.version,
      rule.name,
      rule.discount_type,
      rule.percent,
      rule.amount_cents,
      rule.combinable,
      rule.is_active,
      rule.effective_from,
      rule.effective_to,
      rule.required_audiences,
      rule.min_module_count,
      rule.billing_intervals,
      rule.priority,
    ],
  )
  return rows[0]
}

// Only the fields that carry no pricing semantics; everything else goes
// through a new version.
export async function updatePricingRuleCosmetics(executor, id, fields, values) {
  const { rows } = await executor.query(
    `UPDATE pricing_rules SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length + 1} RETURNING *`,
    [...values, id],
  )
  return rows[0] ?? null
}

export async function deactivatePricingRule(executor, id) {
  const { rows } = await executor.query(
    `UPDATE pricing_rules SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1 AND is_active RETURNING *`,
    [id],
  )
  return rows[0] ?? null
}
