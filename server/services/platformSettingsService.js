// Platform-wide settings domain logic.
import {
  fetchPlatformSettings,
  updateTenantOnboardingEnabled,
} from '../repositories/platformSettingsRepository.js'
import { badRequest } from './serviceErrors.js'

function toPayload(row) {
  return {
    tenantOnboardingEnabled: row.tenant_onboarding_enabled,
    updatedAt: row.updated_at,
    updatedByUserId: row.updated_by_user_id,
  }
}

export async function getPlatformSettings(db) {
  const settings = await fetchPlatformSettings(db)
  return { settings: toPayload(settings) }
}

export async function getTenantOnboardingStatus(db) {
  const { settings } = await getPlatformSettings(db)
  return { tenantOnboardingEnabled: settings.tenantOnboardingEnabled }
}

export async function isTenantOnboardingEnabled(db) {
  const { tenantOnboardingEnabled } = await getTenantOnboardingStatus(db)
  return tenantOnboardingEnabled
}

export async function setTenantOnboardingEnabled(db, body, actorUserId) {
  const enabled = body?.tenantOnboardingEnabled
  if (typeof enabled !== 'boolean') {
    return badRequest('tenantOnboardingEnabled must be a boolean')
  }

  const settings = await updateTenantOnboardingEnabled(db, enabled, actorUserId)
  return {
    settings: toPayload(settings),
    audit: {
      action: 'platform_settings.tenant_onboarding.update',
      details: { status: enabled ? 'enabled' : 'disabled' },
    },
  }
}
