// The `customization` feature's side of the entitlement purge. Customization is
// one feature spanning three tables — tenant branding, song covers and album
// art — so its handler lives with the profile that owns the feature rather than
// with each table.
import { FEATURES } from '../../auth/entitlements.js'
import { registerPurgeHandler } from '../../entitlements/purgeRegistry.js'
import { enqueueCleanup } from '../../platform/files/storageCleanupRepository.js'
import { clearSongCoversForTenant } from '../../music/songs/songRepository.js'
import { clearAlbumArtForTenant } from '../../music/songs/albumRepository.js'
import { clearTenantCustomization } from './profileRepository.js'

// Each clear returns the storage keys it orphaned; they are queued for the
// reconciliation drain inside the caller's transaction.
registerPurgeHandler(FEATURES.CUSTOMIZATION, async (client, tenantId) => {
  const keys = [
    ...(await clearTenantCustomization(client, tenantId)),
    ...(await clearSongCoversForTenant(client, tenantId)),
    ...(await clearAlbumArtForTenant(client, tenantId)),
  ]
  for (const key of keys) await enqueueCleanup(client, tenantId, key, false)
})
