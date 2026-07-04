// Purge of entitlement-gated data when a feature is durably lost. This file
// starts with the integrations surface; the downgrade phase extends it with
// the other purgeable features (song files, chordpro, customization assets)
// and the manifest-driven flow.
//
// GDPR data-processor stance: stored third-party secrets and bearer tokens
// must not outlive the feature that uses them. purgeIntegrationSecrets MUST be
// called by the billing flows when the integrations entitlement is durably
// lost — a voluntary downgrade taking effect, or a cancellation reaching its
// period end. It is NOT called on mere lock states (past_due, payment
// failure): those are temporary and recoverable, and admins can always erase
// credentials manually in the meantime (the credential DELETE endpoints and
// feed-token revocation are deliberately not entitlement-gated).
import {
  clearMollieKeyValue,
  clearBandsintownKeyValue,
  clearShopifyClientIdValue,
  clearShopifySecretValue,
  clearShopifyDomainValue,
} from './profileService.js'
import { clearBandsintownArtist } from '../repositories/profileRepository.js'
import { deleteAllTokensForTenant } from '../repositories/calendarFeedRepository.js'
import { logger } from '../utils/logger.js'

// Removes every stored integration secret, integration configuration, and
// calendar-feed bearer token of a tenant.
export async function purgeIntegrationSecrets(db, tenantId) {
  await clearMollieKeyValue(db, tenantId)
  await clearBandsintownKeyValue(db, tenantId)
  await clearShopifyClientIdValue(db, tenantId)
  await clearShopifySecretValue(db, tenantId)
  await clearShopifyDomainValue(db, tenantId)
  await clearBandsintownArtist(db, tenantId)
  const revokedTokens = await deleteAllTokensForTenant(db, tenantId)
  logger.info('billing.integration_secrets_purged', { tenantId, revokedTokens })
}
