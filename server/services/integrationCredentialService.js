import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '../security/integrationSecrets.js'
import {
  clearCredential,
  fetchCredentialRecord,
  fetchCredentialStatus,
  storeEncryptedCredential,
} from '../repositories/integrationCredentialRepository.js'

export async function loadIntegrationCredential(executor, tenantId, type) {
  const record = await fetchCredentialRecord(executor, tenantId, type)
  if (!record) return null
  if (record.encrypted_value !== null && record.legacy_value !== null) {
    throw new Error('integration_secret_mixed_state')
  }
  if (record.encrypted_value !== null) {
    return decryptIntegrationSecret(record.encrypted_value, tenantId, type)
  }
  return record.legacy_value || null
}

function statusPayload(row, isSet) {
  return { isSet, changedAt: row?.changed_at?.toISOString?.() ?? row?.changed_at ?? null }
}

export async function getIntegrationCredentialStatus(executor, tenantId, type) {
  const row = await fetchCredentialStatus(executor, tenantId, type)
  return statusPayload(row, Boolean(row.is_set))
}

export async function setIntegrationCredential(executor, tenantId, type, plaintext) {
  const envelope = encryptIntegrationSecret(plaintext, tenantId, type)
  const row = await storeEncryptedCredential(executor, tenantId, type, envelope)
  return statusPayload(row, true)
}

export async function clearIntegrationCredential(executor, tenantId, type) {
  const row = await clearCredential(executor, tenantId, type)
  return statusPayload(row, false)
}
