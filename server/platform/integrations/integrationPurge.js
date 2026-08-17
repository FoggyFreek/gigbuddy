// Integrations' side of the entitlement purge: stored third-party secrets and
// bearer tokens must not outlive the feature that uses them.
//
// This handler declares `lock: 'session'` because it mixes REMOTE Mollie calls
// with the local retain-vs-delete decision and must not hold a DB transaction
// open across the remote work. It therefore runs under the same per-tenant
// integration-write session lock that every integration mutation takes, so a
// payment-link create cannot race the key retain/delete decision.
import { FEATURES } from '../../auth/entitlements.js'
import { registerPurgeHandler } from '../../entitlements/purgeRegistry.js'
import {
  clearBandsintownKeyValue,
  clearResendKeyValue,
  clearShopifyClientIdValue,
  clearShopifySecretValue,
  clearShopifyDomainValue,
} from '../../people/profiles/profileService.js'
import { clearBandsintownArtist } from '../../promotion/integrations/tenantIntegrationRepository.js'
import { deleteAllTokensForTenant } from '../../promotion/calendar-feed/calendarFeedRepository.js'
import {
  listInvoicesWithPaymentLink,
  countInvoicesWithPaymentLink,
} from '../../finance/invoices/invoiceRepository.js'
import { removeMolliePaymentLink } from '../../finance/invoices/molliePaymentLinkService.js'
import { CREDENTIAL_TYPES } from '../../security/integrationSecrets.js'
import { clearIntegrationCredential } from './integrationCredentialService.js'
import { setMollieKeyRetained } from './integrationCredentialRepository.js'
import { logger } from '../../utils/logger.js'

// Removes every stored integration secret, integration configuration, and
// calendar-feed bearer token of a tenant. `includeMollie: false` leaves the
// mollie key columns alone — the integrations purge decides retain-vs-delete
// itself and must not have that decision overwritten here.
export async function purgeIntegrationSecrets(db, tenantId, { includeMollie = true } = {}) {
  if (includeMollie) {
    await clearIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY)
  }
  await clearBandsintownKeyValue(db, tenantId)
  await clearResendKeyValue(db, tenantId)
  await clearShopifyClientIdValue(db, tenantId)
  await clearShopifySecretValue(db, tenantId)
  await clearShopifyDomainValue(db, tenantId)
  await clearBandsintownArtist(db, tenantId)
  const revokedTokens = await deleteAllTokensForTenant(db, tenantId)
  logger.info('billing.integration_secrets_purged', { tenantId, revokedTokens })
}

// The session lock is applied by the purge runner from the registry
// declaration below, so `db` here is the POOL with no transaction open.
//
// Remove unpaid Mollie payment links remotely (NO open DB transaction around
// the remote calls), then decide the key's fate — zero links left → delete the
// key; paid links remain → retain the value for webhook/sync while the public
// status reports it absent.
export async function purgeIntegrationsFeature(db, tenantId) {
  // Remote phase: paid links 409 and stay; transient Mollie errors leave the
  // link too (fail toward retention, never toward a dead paid link).
  for (const invoice of await listInvoicesWithPaymentLink(db, tenantId)) {
    try {
      const result = await removeMolliePaymentLink({
        pool: db, tenant: null, invoice, tenantId, invoiceId: invoice.id,
      })
      if (result.error && result.error.body?.code !== 'payment_link_paid') {
        logger.warn('billing.purge_link_remove_failed', { tenantId, invoiceId: invoice.id })
      }
    } catch (err) {
      logger.warn('billing.purge_link_remove_failed', { err, tenantId, invoiceId: invoice.id })
    }
  }

  // Local phase.
  const remaining = await countInvoicesWithPaymentLink(db, tenantId)
  if (remaining === 0) {
    await clearIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY)
  } else {
    await setMollieKeyRetained(db, tenantId)
  }
  await purgeIntegrationSecrets(db, tenantId, { includeMollie: false })
}

registerPurgeHandler(FEATURES.INTEGRATIONS, {
  lock: 'session',
  run: purgeIntegrationsFeature,
})
