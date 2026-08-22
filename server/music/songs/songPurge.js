// Songs' side of the entitlement purge: what `chordpro` and `song_files` mean
// in this schema. Billing decides when a feature is durably lost and provides
// the locked transaction; the deletes themselves belong here.
import { FEATURES } from '../../auth/entitlements.js'
import { registerPurgeHandler } from '../../entitlements/purgeRegistry.js'
import { enqueueCleanup } from '../../platform/files/storageCleanupRepository.js'
import {
  listSongFileKeysForTenant,
  deleteSongFilesForTenant,
  deleteSongChartsForTenant,
} from './songRepository.js'

// Charts are rows only — no storage objects to reclaim.
registerPurgeHandler(FEATURES.CHORDPRO, (client, tenantId) =>
  deleteSongChartsForTenant(client, tenantId))

// Object keys are queued for the reconciliation drain in the SAME transaction
// as the row deletes, so a rollback cannot leave a scheduled delete behind for
// a file that still exists.
registerPurgeHandler(FEATURES.SONG_FILES, async (client, tenantId) => {
  const keys = await listSongFileKeysForTenant(client, tenantId)
  await deleteSongFilesForTenant(client, tenantId)
  for (const key of keys) await enqueueCleanup(client, tenantId, key, false)
})
