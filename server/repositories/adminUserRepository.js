// Data-access helpers for the global super-admin user list. Users are not
// tenant-scoped; memberships join them to tenants. Each query takes an
// `executor` (a pool or transaction client) so callers control transactions.

export async function listUsersWithMemberships(executor) {
  const { rows } = await executor.query(
    `SELECT u.id, u.email, u.name, u.picture_url, u.status,
            u.is_super_admin, u.created_at, u.last_login_at,
            COALESCE(
              (SELECT json_agg(
                        json_build_object(
                          'tenant_id', m.tenant_id,
                          'tenant_slug', t.slug,
                          'role', m.role,
                          'status', m.status
                        ) ORDER BY m.tenant_id
                      )
                 FROM memberships m
                 JOIN tenants t ON t.id = m.tenant_id
                WHERE m.user_id = u.id),
              '[]'::json
            ) AS memberships
       FROM users u
      ORDER BY u.id`,
  )
  return rows
}

export async function getUserEmail(executor, userId) {
  const { rows } = await executor.query('SELECT email FROM users WHERE id = $1', [userId])
  return rows[0]?.email ?? null
}

export async function deleteUser(executor, userId) {
  await executor.query('DELETE FROM users WHERE id = $1', [userId])
}
