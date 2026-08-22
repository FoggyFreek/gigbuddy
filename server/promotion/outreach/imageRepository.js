// Data access for the persistent bearer token behind stable outreach image URLs.
// Tenant profile fields themselves remain owned by profileRepository.js.

export async function ensureOutreachImageToken(executor, tenantId, token) {
  await executor.query(
    `INSERT INTO outreach_image_tokens (tenant_id, token)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, token],
  )
  const { rows } = await executor.query(
    'SELECT token FROM outreach_image_tokens WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0].token
}

export async function resolveOutreachImageToken(executor, token) {
  const { rows } = await executor.query(
    `SELECT oit.tenant_id,
            t.logo_path,
            t.logo_dark_path,
            t.banner_path,
            t.avatar_path,
            t.archived_at,
            t.deletion_status
       FROM outreach_image_tokens oit
       JOIN tenants t ON t.id = oit.tenant_id
      WHERE oit.token = $1`,
    [token],
  )
  return rows[0] ?? null
}
