// Unlocked achievement rows per tenant. Rows are insert-only (unlocks are
// permanent); ON CONFLICT DO NOTHING makes concurrent evaluations harmless.

export async function fetchUnlocked(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT achievement_key, unlocked_at
       FROM tenant_achievements
      WHERE tenant_id = $1
      ORDER BY unlocked_at DESC, id DESC`,
    [tenantId],
  )
  return rows
}

export async function insertUnlocked(executor, tenantId, keys) {
  if (!keys.length) return []
  const values = keys.map((_, i) => `($1, $${i + 2})`).join(', ')
  const { rows } = await executor.query(
    `INSERT INTO tenant_achievements (tenant_id, achievement_key)
     VALUES ${values}
     ON CONFLICT (tenant_id, achievement_key) DO NOTHING
     RETURNING id, achievement_key, unlocked_at`,
    [tenantId, ...keys],
  )
  return rows
}
