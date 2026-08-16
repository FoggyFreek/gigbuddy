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
} from '../../auth/entitlements.js'
import {
  clearBandsintownKeyValue,
  clearResendKeyValue,
  clearShopifyClientIdValue,
  clearShopifySecretValue,
  clearShopifyDomainValue,
} from '../../people/profiles/profileService.js'
import { clearIntegrationCredential } from '../../platform/integrations/integrationCredentialService.js'
import { CREDENTIAL_TYPES } from '../../security/integrationSecrets.js'
import { setMollieKeyRetained } from '../../platform/integrations/integrationCredentialRepository.js'
import { clearTenantCustomization } from '../../people/profiles/profileRepository.js'
import { clearBandsintownArtist } from '../../promotion/integrations/tenantIntegrationRepository.js'
import { deleteAllTokensForTenant } from '../../promotion/calendar-feed/calendarFeedRepository.js'
import {
  listSongFileKeysForTenant,
  deleteSongFilesForTenant,
  deleteSongChartsForTenant,
  clearSongCoversForTenant,
} from '../../music/songs/songRepository.js'
import { clearAlbumArtForTenant } from '../../music/songs/albumRepository.js'
import {
  listInvoicesWithPaymentLink,
  countInvoicesWithPaymentLink,
} from '../../finance/invoices/invoiceRepository.js'
import { removeMolliePaymentLink } from '../../finance/invoices/molliePaymentLinkService.js'
import { enqueueCleanup } from '../../platform/files/storageCleanupRepository.js'
import { fetchSubscriptionById } from './subscriptionRepository.js'
import {
  fetchModuleById,
  clearModulePurgeManifest,
} from './subscriptionModuleRepository.js'
import { fetchFallbackPlan } from '../plans/planRepository.js'
import { listOwnedTenants } from './limitRepository.js'
import { tenantKindsForAudience } from '../../../shared/planAudiences.js'
import {
  withTenantFeatureLock,
  withIntegrationWriteLock,
} from './featureGuards.js'
import { auditLog } from '../../utils/auditLog.js'
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
        const keys = [
          ...(await clearTenantCustomization(client, tenantId)),
          ...(await clearSongCoversForTenant(client, tenantId)),
          ...(await clearAlbumArtForTenant(client, tenantId)),
        ]
        for (const key of keys) await enqueueCleanup(client, tenantId, key, false)
      })
    } else if (feature === FEATURES.INTEGRATIONS) {
      await purgeIntegrationsFeature(db, tenantId)
    }
    logger.info('billing.feature_purged', { tenantId, feature })
  }
}

// What a module grants RIGHT NOW, for scoping its purge. A module that is gone
// (removed at the period boundary) falls back to its ladder's free floor.
// Overrides apply in both cases, so an override-granted feature is never purged.
async function effectiveEntitlementsNow(db, { module, audience, overrides }) {
  if (!module) {
    // The floor of this module's OWN ladder — a removed artist module falls
    // back to the artist floor, never the band one.
    const fallback = await fetchFallbackPlan(db, audience)
    return mergeEntitlements(fallback.entitlements, overrides ?? null)
  }
  return mergeEntitlements(module.plan_entitlements, module.entitlement_overrides)
}

// Resolves the purge target into { subscriptionId, audience, manifest, module }.
// Two shapes, because a removal deletes the row the manifest lived on:
//   { moduleId }                              — a downgrade that has landed
//   { subscriptionId, audience, manifest }    — a module removed at the boundary
async function resolvePurgeTarget(db, { moduleId, subscriptionId, audience, manifest }) {
  if (moduleId) {
    const module = await fetchModuleById(db, moduleId)
    if (!module) return null
    const sub = await fetchSubscriptionById(db, module.subscription_id)
    if (!sub) return null
    return {
      subscriptionId: module.subscription_id,
      userId: sub.user_id,
      audience: module.audience,
      manifest: module.pending_purge_manifest,
      module,
    }
  }
  const sub = await fetchSubscriptionById(db, subscriptionId)
  if (!sub) return null
  return { subscriptionId, userId: sub.user_id, audience, manifest, module: null }
}

// Executes a frozen purge manifest for ONE module across every tenant of that
// module's kind the owner holds. Idempotent and self-serializing: concurrent
// callers (the inline post-activation hook vs. the scheduler safety net) skip
// on the session advisory lock; a missing manifest is a no-op.
//
// Recovery-safe scope: the frozen manifest lists the features that WERE enabled
// at confirmation; only those still off on the current effective entitlements
// are purged — an admin plan edit after confirmation can only SHRINK the purge,
// never expand it.
export async function executeModulePurge(db, target) {
  const resolved = await resolvePurgeTarget(db, target)
  if (!resolved || !resolved.manifest) return { purged: false, reason: 'no_manifest' }

  const { subscriptionId, userId, audience, manifest, module } = resolved
  const client = await db.connect()
  const lockName = `module_purge:${subscriptionId}:${audience}`
  let locked = false
  try {
    const { rows: [row] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockName])
    locked = row.locked
    if (!locked) return { purged: false, reason: 'locked' }

    const effNow = await effectiveEntitlementsNow(db, {
      module, audience, overrides: module?.entitlement_overrides ?? null,
    })
    const features = (Array.isArray(manifest.features) ? manifest.features : [])
      .filter((f) => PURGEABLE_FEATURES.includes(f) && effNow.features[f] === false)

    // Scoped to the module's own ladder: an artist downgrade purges only the
    // personal workspace, a band downgrade only bands. The two products are
    // billed together but granted separately, so one lapsing must not delete
    // the other's data.
    //
    // Archived tenants of that kind are still included: they can be unarchived,
    // so the promised deletion must reach them too.
    const tenants = await listOwnedTenants(db, userId, tenantKindsForAudience(audience))
    for (const tenant of tenants) {
      await purgeFeatureData(db, tenant.id, features)
      auditLog(null, 'billing.purge_executed', {
        userId, tenantId: tenant.id, subscriptionId,
      })
    }

    if (module) await clearModulePurgeManifest(db, module.id)
    logger.info('billing.purge_executed', { subscriptionId, userId })
    return { purged: true, features }
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName])
        .catch((err) => logger.error('billing.purge_unlock_failed', { err, subscriptionId }))
    }
    client.release()
  }
}
