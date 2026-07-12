// Data-access helpers for authentication / session bootstrap. Each query takes
// an `executor` (a pool or transaction client) so callers control transactions.
// Users and memberships are global; tenant scoping happens via memberships.

export async function fetchUserById(executor, userId) {
  const { rows } = await executor.query('SELECT * FROM users WHERE id = $1', [userId])
  return rows[0] || null
}

// Pending + approved memberships in non-archived tenants, for the /me payload.
export async function listMembershipsForMe(executor, userId) {
  const { rows } = await executor.query(
    `SELECT m.tenant_id, m.role, m.status, t.slug AS tenant_slug, t.band_name AS tenant_name
     FROM memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1
       AND m.status IN ('pending', 'approved')
       AND t.archived_at IS NULL
     ORDER BY m.tenant_id ASC`,
    [userId],
  )
  return rows
}

export async function getBandMemberId(executor, userId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0]?.id ?? null
}

export async function anySuperAdminExists(executor) {
  const { rowCount } = await executor.query('SELECT 1 FROM users WHERE is_super_admin = TRUE LIMIT 1')
  return rowCount > 0
}

// The only two identity slots. Column names come from this map, never from
// caller input — providers are code-defined, not user-defined.
const PROVIDER_SUB_COLUMNS = {
  google: 'google_sub',
  microsoft: 'microsoft_sub',
}

function subColumn(provider) {
  const column = PROVIDER_SUB_COLUMNS[provider]
  if (!column) throw new Error(`Unknown OIDC provider: ${provider}`)
  return column
}

// Refreshes profile fields for a returning user matched by provider sub.
// Email is only refreshed from Google (verified claim); a Microsoft email
// carries no verified assertion and never updates the account. An absent
// picture claim (Microsoft has none) keeps the stored picture.
export async function updateUserOnLogin(executor, provider, claims) {
  const column = subColumn(provider)
  const emailSet = provider === 'google' ? 'email = $4,' : ''
  const params = [claims.sub, claims.name, claims.picture ?? null]
  if (provider === 'google') params.push(claims.email)
  const { rows } = await executor.query(
    `UPDATE users SET
       name = $2,
       picture_url = COALESCE($3, picture_url),
       ${emailSet}
       last_login_at = NOW()
     WHERE ${column} = $1
     RETURNING *`,
    params,
  )
  return rows[0] || null
}

export async function emailExists(executor, email) {
  const { rowCount } = await executor.query('SELECT 1 FROM users WHERE email = $1', [email])
  return rowCount > 0
}

// First sign-in insert. is_super_admin/status are creation-time only. Raw
// unique violations (email or sub race) propagate for the service to map.
export async function insertUserFromClaims(executor, provider, claims, isSuperAdmin, status) {
  const column = subColumn(provider)
  const { rows } = await executor.query(
    `INSERT INTO users (${column}, email, name, picture_url, is_super_admin, status, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [claims.sub, claims.email, claims.name, claims.picture ?? null, isSuperAdmin, status],
  )
  return rows[0]
}

// Fills an empty identity slot; 0 rows = slot already occupied (or unknown
// user). A UNIQUE violation (sub linked to another user) propagates.
export async function setProviderSub(executor, userId, provider, sub) {
  const column = subColumn(provider)
  const { rowCount } = await executor.query(
    `UPDATE users SET ${column} = $2 WHERE id = $1 AND ${column} IS NULL`,
    [userId, sub],
  )
  return rowCount > 0
}

// Clears an identity slot only while another sign-in method remains — a user
// must never be locked out by unlinking their last provider.
export async function clearProviderSub(executor, userId, provider) {
  const column = subColumn(provider)
  const others = Object.values(PROVIDER_SUB_COLUMNS).filter((c) => c !== column)
  const remaining = others.map((c) => `${c} IS NOT NULL`).join(' OR ')
  const { rowCount } = await executor.query(
    `UPDATE users SET ${column} = NULL WHERE id = $1 AND ${column} IS NOT NULL AND (${remaining})`,
    [userId],
  )
  return rowCount > 0
}

// Grants the bootstrap admin an approved tenant_admin membership in the seed
// tenant (id 1), preserving an existing approved_at.
export async function upsertSeedAdminMembership(executor, userId) {
  await executor.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
     VALUES ($1, 1, 'tenant_admin', 'approved', NOW())
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET
       role = 'tenant_admin',
       status = 'approved',
       approved_at = COALESCE(memberships.approved_at, NOW())`,
    [userId],
  )
}

export async function firstApprovedTenantId(executor, userId) {
  const { rows } = await executor.query(
    `SELECT m.tenant_id
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.status = 'approved'
        AND t.archived_at IS NULL
      ORDER BY m.tenant_id ASC
      LIMIT 1`,
    [userId],
  )
  return rows[0]?.tenant_id ?? null
}

// Records terms acceptance. A CASE expression (not a zero-row WHERE guard) so
// the statement always returns a row: re-accepting the same version keeps the
// original timestamp, a new version replaces both fields atomically.
export async function setTermsAccepted(executor, userId, version) {
  const { rows } = await executor.query(
    `UPDATE users SET
       terms_accepted_at = CASE WHEN terms_version IS DISTINCT FROM $2 THEN NOW() ELSE terms_accepted_at END,
       terms_version = $2
     WHERE id = $1
     RETURNING terms_accepted_at, terms_version`,
    [userId, version],
  )
  return rows[0] || null
}

// Clears the onboarding resume pointer once the flow finishes. Idempotent.
export async function clearOnboardingTenant(executor, userId) {
  await executor.query('UPDATE users SET onboarding_tenant_id = NULL WHERE id = $1', [userId])
}

// Marks the tenant created during onboarding as the flow's resume pointer;
// runs inside the tenant-create transaction so the pointer can never dangle.
export async function setOnboardingTenant(executor, userId, tenantId) {
  await executor.query('UPDATE users SET onboarding_tenant_id = $2 WHERE id = $1', [userId, tenantId])
}

// The tutorial keys this user has dismissed (per-user, global). Feeds the
// /auth/me payload so the frontend tutorial host can skip them.
export async function listDismissedTutorials(executor, userId) {
  const { rows } = await executor.query(
    'SELECT tutorial_key FROM user_tutorial_dismissals WHERE user_id = $1',
    [userId],
  )
  return rows.map((r) => r.tutorial_key)
}

// Records that the user dismissed a tutorial. Idempotent (keep the first
// dismissal timestamp on a repeat).
export async function dismissTutorial(executor, userId, key) {
  await executor.query(
    `INSERT INTO user_tutorial_dismissals (user_id, tutorial_key)
     VALUES ($1, $2)
     ON CONFLICT (user_id, tutorial_key) DO NOTHING`,
    [userId, key],
  )
}

export async function isApprovedMember(executor, userId, tenantId) {
  const { rowCount } = await executor.query(
    `SELECT 1
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.tenant_id = $2
        AND m.status = 'approved'
        AND t.archived_at IS NULL`,
    [userId, tenantId],
  )
  return rowCount > 0
}
