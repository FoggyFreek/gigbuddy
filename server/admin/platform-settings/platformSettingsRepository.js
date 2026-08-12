// Data-access helpers for singleton platform-wide settings.
const SETTINGS_ID = true

const SETTINGS_COLUMNS = `
  id,
  tenant_onboarding_enabled,
  updated_at,
  updated_by_user_id
`

export async function fetchPlatformSettings(executor) {
  const inserted = await executor.query(
    `INSERT INTO platform_settings (id)
     VALUES ($1)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${SETTINGS_COLUMNS}`,
    [SETTINGS_ID],
  )
  if (inserted.rows[0]) return inserted.rows[0]

  const { rows } = await executor.query(
    `SELECT ${SETTINGS_COLUMNS}
       FROM platform_settings
      WHERE id = $1`,
    [SETTINGS_ID],
  )
  return rows[0]
}

export async function updateTenantOnboardingEnabled(executor, enabled, actorUserId) {
  const { rows } = await executor.query(
    `INSERT INTO platform_settings (id, tenant_onboarding_enabled, updated_by_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (id)
     DO UPDATE SET tenant_onboarding_enabled = EXCLUDED.tenant_onboarding_enabled,
                   updated_by_user_id = EXCLUDED.updated_by_user_id,
                   updated_at = NOW()
     RETURNING ${SETTINGS_COLUMNS}`,
    [SETTINGS_ID, enabled, actorUserId],
  )
  return rows[0]
}
