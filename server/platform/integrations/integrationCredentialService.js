import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '../../security/integrationSecrets.js'
import {
  clearCredential,
  fetchCredentialRecord,
  fetchCredentialStatus,
  storeEncryptedCredential,
} from './integrationCredentialRepository.js'
import { logger } from '../../utils/logger.js'

export async function loadIntegrationCredential(executor, tenantId, type) {
  const record = await fetchCredentialRecord(executor, tenantId, type)
  if (!record) return null
  // A retained credential (kept alive after an integrations purge solely for
  // paid payment links) reads as absent through the public accessor.
  if (record.retained_at) return null
  return decryptRecord(record, tenantId, type)
}

// Internal accessor for the payment-link webhook/sync path ONLY: still
// decrypts a credential whose value is retained after an integrations purge.
export async function loadRetainedIntegrationCredential(executor, tenantId, type) {
  const record = await fetchCredentialRecord(executor, tenantId, type)
  if (!record) return null
  return decryptRecord(record, tenantId, type)
}

function decryptRecord(record, tenantId, type) {
  if (record.encrypted_value === null) return null
  return decryptIntegrationSecret(record.encrypted_value, tenantId, type)
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

// Shared preamble for the services that build a third-party client from a
// tenant credential (Mollie, Resend, Shopify): decrypt, or return the standard
// { error: { status, body } } contract. A decryption failure is 503 (the value
// is there but unreadable — operator problem); an absent value is 400.
//
// `logEvent` is passed as a literal rather than derived so the emitted event
// name stays greppable. `label` opts into the message+code body shape; omit it
// for the bare { error: '<integration>_not_configured' } body. `load` swaps in
// the retained-credential accessor for Mollie's webhook/sync path.
export async function loadCredentialOrError(executor, tenantId, type, {
  integration,
  logEvent,
  label = null,
  load = loadIntegrationCredential,
}) {
  let value
  try {
    value = await load(executor, tenantId, type)
  } catch (err) {
    logger.error(logEvent, { err, tenantId })
    return { error: { status: 503, body: { error: `${integration}_credential_unavailable` } } }
  }
  if (!value) {
    const body = label
      ? { error: `${label} is not configured`, code: `${integration}_not_configured` }
      : { error: `${integration}_not_configured` }
    return { error: { status: 400, body } }
  }
  return { value }
}
