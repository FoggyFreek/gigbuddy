// Data-access helpers for per-user iCalendar feed tokens. Each query takes an
// `executor` (a pool or transaction client) so callers control transactions.

export async function getTokenByUserTenant(executor, userId, tenantId) {
  const { rows } = await executor.query(
    `SELECT token, created_at, last_accessed_at
       FROM ical_feed_tokens
      WHERE user_id = $1 AND tenant_id = $2`,
    [userId, tenantId],
  )
  return rows[0] ?? null
}

// Creates or rotates the (user, tenant) feed token in place. Rotating resets
// created_at and clears last_accessed_at, and — because token has a UNIQUE
// constraint — invalidates the previous URL.
export async function upsertToken(executor, userId, tenantId, token) {
  const { rows } = await executor.query(
    `INSERT INTO ical_feed_tokens (user_id, tenant_id, token)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, tenant_id)
       DO UPDATE SET token = EXCLUDED.token,
                     created_at = NOW(),
                     last_accessed_at = NULL
     RETURNING token, created_at, last_accessed_at`,
    [userId, tenantId, token],
  )
  return rows[0]
}

export async function deleteToken(executor, userId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM ical_feed_tokens WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rowCount > 0
}

// Resolves a feed token to the access context needed to authorize the public
// feed. Joins users + memberships + tenants so the route can reject in one
// lookup: unknown token, non-approved user, non-approved membership, or an
// archived tenant. Returns null only when the token does not exist.
export async function resolveToken(executor, token) {
  const { rows } = await executor.query(
    `SELECT ift.user_id,
            ift.tenant_id,
            u.status              AS user_status,
            m.status              AS membership_status,
            t.archived_at         AS tenant_archived_at,
            t.band_name           AS band_name
       FROM ical_feed_tokens ift
       JOIN users u    ON u.id = ift.user_id
       JOIN tenants t  ON t.id = ift.tenant_id
       LEFT JOIN memberships m
         ON m.user_id = ift.user_id AND m.tenant_id = ift.tenant_id
      WHERE ift.token = $1`,
    [token],
  )
  return rows[0] ?? null
}

export async function touchToken(executor, token) {
  await executor.query(
    'UPDATE ical_feed_tokens SET last_accessed_at = NOW() WHERE token = $1',
    [token],
  )
}
