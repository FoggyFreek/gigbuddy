// Purge of entitlement-gated data when a feature is durably lost — the
// manifest-driven downgrade flow plus the integrations-secret erasure it
// builds on.
//
// GDPR data-processor stance: stored third-party secrets and bearer tokens
// must not outlive the feature that uses them. The purge is called only when
// a feature is DURABLY lost (a downgrade's target plan becoming real, or a
// cancellation reaching its period end) — never on mere lock states
// (past_due, payment failure): those are temporary and recoverable, and
// admins can always erase credentials manually in the meantime (the
// credential DELETE endpoints and feed-token revocation are deliberately not
// entitlement-gated).
//
// Concurrency (see featureGuards.js):
// - One purge run per subscription is serialized by a session-level advisory
//   lock (`downgrade_purge:<subId>`) held across the whole run — it spans
//   multiple tenants and remote Mollie calls, so it is NOT a transaction lock;
//   no DB transaction stays open across remote/S3 work.
// - Each per-(tenant, feature) delete is one short transaction under the
//   tenant advisory lock that every purgeable-feature WRITE also takes (with
//   an in-txn entitlement recheck), so write-vs-purge is safe in either order.
// - The integrations phase runs under the per-tenant integration-write
//   session lock instead, because it mixes remote link removal with the local
//   retain-vs-delete decision.
import {
  FEATURES,
  PURGEABLE_FEATURES,
  mergeEntitlements,
} from '../auth/entitlements.js'
import {
  clearBandsintownKeyValue,
  clearShopifyClientIdValue,
  clearShopifySecretValue,
  clearShopifyDomainValue,
} from './profileService.js'
import { clearIntegrationCredential } from './integrationCredentialService.js'
import { CREDENTIAL_TYPES } from '../security/integrationSecrets.js'
import { setMollieKeyRetained } from '../repositories/integrationCredentialRepository.js'
import { clearBandsintownArtist, clearTenantCustomization } from '../repositories/profileRepository.js'
import { deleteAllTokensForTenant } from '../repositories/calendarFeedRepository.js'
import {
  listSongFileKeysForTenant,
  deleteSongFilesForTenant,
  deleteSongChartsForTenant,
} from '../repositories/songRepository.js'
import {
  listInvoicesWithPaymentLink,
  countInvoicesWithPaymentLink,
} from '../repositories/invoiceRepository.js'
import { removeMolliePaymentLink } from './molliePaymentLinkService.js'
import { enqueueCleanup } from '../repositories/storageCleanupRepository.js'
import {
  fetchSubscriptionById,
  clearPurgeManifest,
} from '../repositories/subscriptionRepository.js'
import { fetchFallbackPlan } from '../repositories/planRepository.js'
import { listOwnedTenants } from '../repositories/limitRepository.js'
import {
  withTenantFeatureLock,
  withIntegrationWriteLock,
} from './featureGuards.js'
import { auditLog } from '../utils/auditLog.js'
import { logger } from '../utils/logger.js'

// Removes every stored integration secret, integration configuration, and
// calendar-feed bearer token of a tenant. `includeMollie: false` leaves the
// mollie key columns alone — the integrations purge decides retain-vs-delete
// itself and must not have that decision overwritten here.
export async function purgeIntegrationSecrets(db, tenantId, { includeMollie = true } = {}) {
  if (includeMollie) {
    await clearIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY)
  }
  await clearBandsintownKeyValue(db, tenantId)
  await clearShopifyClientIdValue(db, tenantId)
  await clearShopifySecretValue(db, tenantId)
  await clearShopifyDomainValue(db, tenantId)
  await clearBandsintownArtist(db, tenantId)
  const revokedTokens = await deleteAllTokensForTenant(db, tenantId)
  logger.info('billing.integration_secrets_purged', { tenantId, revokedTokens })
}

// Integrations purge: remove unpaid Mollie payment links remotely (NO open DB
// transaction around the remote calls), then decide the key's fate — zero
// links left → delete the key; paid links remain → retain the value for
// webhook/sync while the public status reports it absent.
async function purgeIntegrationsFeature(db, tenantId) {
  await withIntegrationWriteLock(db, tenantId, async () => {
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
  })
}

// Deletes a tenant's data for the given purgeable features — one transaction
// per (tenant, feature) under the tenant advisory lock; storage object keys
// are queued for the reconciliation drain in the same transaction as the row
// deletes.
export async function purgeFeatureData(db, tenantId, features) {
  for (const feature of features) {
    if (feature === FEATURES.CHORDPRO) {
      await withTenantFeatureLock(db, tenantId, (client) =>
        deleteSongChartsForTenant(client, tenantId))
    } else if (feature === FEATURES.SONG_FILES) {
      await withTenantFeatureLock(db, tenantId, async (client) => {
        const keys = await listSongFileKeysForTenant(client, tenantId)
        await deleteSongFilesForTenant(client, tenantId)
        for (const key of keys) await enqueueCleanup(client, tenantId, key, false)
      })
    } else if (feature === FEATURES.CUSTOMIZATION) {
      await withTenantFeatureLock(db, tenantId, async (client) => {
        const keys = await clearTenantCustomization(client, tenantId)
        for (const key of keys) await enqueueCleanup(client, tenantId, key, false)
      })
    } else if (feature === FEATURES.INTEGRATIONS) {
      await purgeIntegrationsFeature(db, tenantId)
    }
    logger.info('billing.feature_purged', { tenantId, feature })
  }
}

// What the subscription grants RIGHT NOW, for scoping a purge: a canceled row
// falls back to the fallback plan; a live row uses its (possibly already
// switched) plan. Overrides apply in both cases so an override-granted
// feature is never purged.
async function effectiveEntitlementsNow(db, sub) {
  if (sub.status === 'canceled') {
    const fallback = await fetchFallbackPlan(db)
    return mergeEntitlements(fallback.entitlements, sub.entitlement_overrides)
  }
  return mergeEntitlements(sub.plan_entitlements, sub.entitlement_overrides)
}

// Executes a frozen purge manifest for a subscription across every tenant the
// owner holds. Idempotent and self-serializing: concurrent callers (inline
// post-activation hook vs. the scheduler safety net) skip on the session
// advisory lock; a missing manifest is a no-op.
//
// Recovery-safe scope: the frozen manifest lists the features that WERE
// enabled at confirmation; only those still off on the current effective
// entitlements are purged — an admin plan edit after confirmation can only
// SHRINK the purge, never expand it.
export async function executeDowngradePurge(db, subId) {
  const client = await db.connect()
  const lockName = `downgrade_purge:${subId}`
  let locked = false
  try {
    const { rows: [row] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockName])
    locked = row.locked
    if (!locked) return { purged: false, reason: 'locked' }

    const sub = await fetchSubscriptionById(db, subId)
    const manifest = sub?.pending_purge_manifest
    if (!manifest) return { purged: false, reason: 'no_manifest' }

    const effNow = await effectiveEntitlementsNow(db, sub)
    const features = (Array.isArray(manifest.features) ? manifest.features : [])
      .filter((f) => PURGEABLE_FEATURES.includes(f) && effNow.features[f] === false)

    // Archived tenants included: they can be unarchived, so the promised
    // deletion must reach them too.
    const tenants = await listOwnedTenants(db, sub.user_id)
    for (const tenant of tenants) {
      await purgeFeatureData(db, tenant.id, features)
      auditLog(null, 'billing.purge_executed', {
        userId: sub.user_id, tenantId: tenant.id, subscriptionId: sub.id,
      })
    }

    await clearPurgeManifest(db, subId)
    logger.info('billing.purge_executed', { subscriptionId: subId, userId: sub.user_id })
    return { purged: true, features }
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName])
        .catch((err) => logger.error('billing.purge_unlock_failed', { err, subscriptionId: subId }))
    }
    client.release()
  }
}
