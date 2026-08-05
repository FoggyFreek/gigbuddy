// Data access for the band directory — the one deliberate exception to tenant
// discoverability. Every query here is constrained to bands that opted in
// (`join_policy = 'request'`), are not archived, and are of kind 'band'; a
// personal workspace is excluded structurally, not merely by default.
//
// These are NOT tenant-scoped reads: the caller has no membership in the rows
// they see, which is the point. Nothing beyond minimal public identity is
// selected — no member counts, no contact details, nothing financial.

const DISCOVERABLE = `kind = 'band' AND join_policy = 'request' AND archived_at IS NULL`

// Minimal public identity plus the caller's own membership status, so the UI
// can label a row ("pending", "you're already in this band") instead of
// failing on submit.
export async function searchDiscoverableTenants(executor, { query, limit, userId }) {
  const { rows } = await executor.query(
    `SELECT t.id, t.slug, t.display_name, t.logo_path,
            COALESCE(m.status, 'none') AS membership_status
       FROM tenants t
       LEFT JOIN memberships m ON m.tenant_id = t.id AND m.user_id = $2
      WHERE ${DISCOVERABLE}
        AND t.display_name ILIKE '%' || $1 || '%'
      ORDER BY t.display_name ASC, t.id ASC
      LIMIT $3`,
    [query, userId, limit],
  )
  return rows
}

// Re-validates a search hit inside the join transaction: a search result is a
// hint, never authorization. Returns null when the tenant is not (or is no
// longer) discoverable — the caller turns that into a 404.
export async function fetchDiscoverableTenant(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, slug, display_name FROM tenants WHERE id = $1 AND ${DISCOVERABLE}`,
    [tenantId],
  )
  return rows[0] || null
}

export async function fetchMembership(executor, userId, tenantId) {
  const { rows } = await executor.query(
    'SELECT status, role, source FROM memberships WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0] || null
}

// Counts the caller's outstanding self-service requests. A pending row from a
// redeemed invite is an admin's doing, not spam, so `source` narrows it.
export async function countOpenJoinRequests(executor, userId) {
  const { rows } = await executor.query(
    `SELECT COUNT(*)::int AS count FROM memberships
      WHERE user_id = $1 AND status = 'pending' AND source = 'request'`,
    [userId],
  )
  return rows[0].count
}

// The bands the caller currently has an open request with — what the UI shows
// next to the cap.
export async function listOpenJoinRequests(executor, userId) {
  const { rows } = await executor.query(
    `SELECT t.id, t.slug, t.display_name, m.request_message, m.created_at
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1 AND m.status = 'pending' AND m.source = 'request'
      ORDER BY m.created_at DESC, t.id DESC`,
    [userId],
  )
  return rows
}

// Withdrawal: removes the caller's OWN row, and only while it is a pending
// self-service request. Never an approved membership (leaving a band is a
// different operation) and never someone else's row. Returns true when a row
// was removed.
export async function deleteOwnJoinRequest(executor, userId, tenantId) {
  const { rowCount } = await executor.query(
    `DELETE FROM memberships
      WHERE user_id = $1 AND tenant_id = $2 AND status = 'pending' AND source = 'request'`,
    [userId, tenantId],
  )
  return rowCount > 0
}
