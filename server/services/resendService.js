import { Resend } from 'resend'
import { CREDENTIAL_TYPES } from '../security/integrationSecrets.js'
import { loadCredentialOrError } from './integrationCredentialService.js'

export async function getResendClientForTenant(executor, tenantId) {
  const result = await loadCredentialOrError(executor, tenantId, CREDENTIAL_TYPES.RESEND_API_KEY, {
    integration: 'resend',
    logEvent: 'resend.credential_decryption_failed',
    label: 'Resend API key',
  })
  if (result.error) return result
  return { resend: new Resend(result.value) }
}
