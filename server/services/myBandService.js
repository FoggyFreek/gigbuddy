// A personal workspace's My Bands collection: the bands an artist plays in that
// are not gigbuddy customers, so their events can be tagged with a band.
//
// Lock order, which every path here obeys and nothing here may reorder:
//
//     tenants -> band_profiles (ascending id) -> my_bands / events
//
// It is global rather than local to this feature because tenant deletion already
// holds the tenant row and then cascades into band_profile_claims and
// band_profiles. A path that took the profile first and the tenant second would
// deadlock against it.
//
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { limitedCollection } from './limitedCollectionService.js'
import { safeRemove } from './storageService.js'
import { logger } from '../utils/logger.js'
import { lockTenantRow } from '../repositories/tenantRepository.js'
import {
  parseBandProfileCreate,
  parseRemovalMode,
} from '../validators/bandProfileValidators.js'
import { parsePositiveId } from '../validators/common.js'
import {
  MAX_HOLDERS_PER_PROFILE,
  MAX_MY_BANDS_PER_TENANT,
  MAX_BAND_PROFILES_PER_USER,
  MY_BAND_REMOVAL_MODES,
} from '../domain/bandProfiles.js'
import {
  lockBandProfile,
  insertBandProfile,
  countProfilesCreatedByUser,
  deleteBandProfileIfAbandoned,
} from '../repositories/bandProfileRepository.js'
import {
  listMyBands as listMyBandRows,
  fetchMyBand,
  findMyBandByProfile,
  insertMyBand,
  deleteMyBand,
  countMyBands,
  countHolders,
  countLinkedEvents,
  listLinkedGigStorageKeys,
  deleteLinkedEvents,
  lockMyBandForEventWrite,
} from '../repositories/myBandRepository.js'
import { shapeBandProfile, invalidInput, mapDuplicate } from './bandProfileService.js'
import { conflict, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Not found')

const capReached = (message, code, limit) => conflict(message, { code, limit })

// The repository speaks the database's snake_case; the API speaks camelCase.
// This is the one place the two meet, so a renamed table cannot silently zero a
// count on the way out.
const NO_EVENTS = Object.freeze({ gigs: 0, rehearsals: 0, bandEvents: 0 })

const shapeEventCounts = (row, suffix = '') => ({
  gigs: row[`gigs${suffix}`] ?? 0,
  rehearsals: row[`rehearsals${suffix}`] ?? 0,
  bandEvents: row[`band_events${suffix}`] ?? 0,
})

function shapeMyBand(row) {
  return {
    id: row.my_band_id,
    bandProfile: shapeBandProfile(row),
    eventCounts: shapeEventCounts(row, '_count'),
    addedAt: row.added_at,
  }
}

// ---------- reads ----------

// The collection is capped at 50, so the default limit must be 50 too. Passing
// the cap as limitedCollection's MAXIMUM would not do it: parseListLimit
// defaults an omitted limit to 10 regardless of the maximum, silently truncating
// a full collection.
export async function listBands(db, tenantId, query) {
  const result = await limitedCollection(
    query?.limit ?? MAX_MY_BANDS_PER_TENANT,
    (limit) => listMyBandRows(db, tenantId, limit),
    MAX_MY_BANDS_PER_TENANT,
  )
  if (result.error) return result
  return { ...result, items: result.items.map(shapeMyBand) }
}

// What removing this band would touch. Read-only, so the confirm dialog can
// state the consequences before anyone commits to them.
export async function getRemovalPreview(db, tenantId, myBandId) {
  const row = await fetchMyBand(db, myBandId, tenantId)
  if (!row) return NOT_FOUND
  return { counts: shapeEventCounts(await countLinkedEvents(db, tenantId, myBandId)) }
}

// ---------- writes ----------

// Takes either an existing profile id or a whole profile to create. Creating and
// holding are ONE transaction on purpose: a create-then-add pair could be
// interrupted between the two calls and leave a global row nobody holds, which
// nothing would ever clean up.
export async function addBand(db, user, tenantId, body) {
  const target = parseAddTarget(body)
  if (target.error) return target

  const result = await withTransaction(async (client) => {
    await lockTenantRow(client, tenantId)

    const profileId = target.bandProfileId ?? await createProfile(client, user, target.profile)
    const profile = await lockBandProfile(client, profileId)
    if (!profile) abortTransaction(notFound('Band profile not found'))

    // Idempotent: adding a band already in the collection is a no-op, not an
    // error — the dialog may well be re-submitted.
    const existing = await findMyBandByProfile(client, tenantId, profileId)
    if (existing !== null) {
      return { created: false, myBandId: existing }
    }

    // A claimed profile exists only to keep its remaining holders' event links
    // resolving. New arrivals belong in the real band, not here — which is also
    // what makes the holder set shrink monotonically to zero.
    if (profile.claimed_by_tenant_id !== null) {
      abortTransaction(conflict('This band is on gigbuddy now — join the band instead', {
        code: 'band_profile_claimed',
      }))
    }

    if (await countHolders(client, profileId) >= MAX_HOLDERS_PER_PROFILE) {
      abortTransaction(capReached(
        'This band profile already has the maximum number of members',
        'band_profile_full', MAX_HOLDERS_PER_PROFILE,
      ))
    }

    if (await countMyBands(client, tenantId) >= MAX_MY_BANDS_PER_TENANT) {
      abortTransaction(capReached(
        'You have reached the maximum number of bands',
        'my_bands_limit', MAX_MY_BANDS_PER_TENANT,
      ))
    }

    const myBandId = await insertMyBand(client, tenantId, profileId)
    return {
      created: true,
      myBandId,
      audit: { action: 'my_band.add', details: { tenantId, bandProfileId: profileId } },
    }
  }, { db, mapError: mapDuplicate })

  if (result.error) return result
  return { ...result, myBand: shapeMyBand(await fetchMyBand(db, result.myBandId, tenantId)) }
}

function parseAddTarget(body) {
  const rawId = body?.bandProfileId ?? body?.band_profile_id
  if (rawId !== undefined && rawId !== null) {
    const bandProfileId = parsePositiveId(rawId)
    if (bandProfileId === null) return invalidInput('invalid_band_profile_id')
    return { bandProfileId }
  }

  const source = body?.bandProfile ?? body?.band_profile
  if (source === undefined || source === null) return invalidInput('band_profile_required')

  const parsed = parseBandProfileCreate(source)
  if (parsed.error) return invalidInput(parsed.error)
  return { profile: parsed.profile }
}

async function createProfile(client, user, profile) {
  if (await countProfilesCreatedByUser(client, user.id) >= MAX_BAND_PROFILES_PER_USER) {
    abortTransaction(capReached(
      'You have added the maximum number of band profiles',
      'band_profile_limit', MAX_BAND_PROFILES_PER_USER,
    ))
  }
  return insertBandProfile(client, profile, user.id)
}

// Removing a band never deletes a musician's events by default: `keep` unlinks
// them, `delete` removes them. Returns the object keys the caller must reclaim
// AFTER the transaction commits — reclaiming inside it would leave a rolled-back
// gig pointing at files that are already gone.
export async function removeBand(db, tenantId, myBandId, query) {
  const parsedMode = parseRemovalMode(query?.mode)
  if (parsedMode.error) return invalidInput(parsedMode.error)
  const { mode } = parsedMode

  const result = await withTransaction(async (client) => {
    await lockTenantRow(client, tenantId)

    const row = await fetchMyBand(client, myBandId, tenantId)
    if (!row) abortTransaction(NOT_FOUND)

    // Parent before child, matching the global order.
    await lockBandProfile(client, row.band_profile_id)

    const counts = shapeEventCounts(await countLinkedEvents(client, tenantId, myBandId))

    // Both reads must happen while my_band_id still points at this row:
    // deleting it fires ON DELETE SET NULL and the events become unidentifiable.
    let storageKeys = []
    let deleted = NO_EVENTS
    if (mode === MY_BAND_REMOVAL_MODES.DELETE) {
      storageKeys = await listLinkedGigStorageKeys(client, tenantId, myBandId)
      deleted = shapeEventCounts(await deleteLinkedEvents(client, tenantId, myBandId))
    }

    await deleteMyBand(client, myBandId, tenantId)

    // The profile's whole purpose is to serve the people holding it. With the
    // last holder gone and no claim in flight, it has none.
    const profileDeleted = await deleteBandProfileIfAbandoned(client, row.band_profile_id)

    return {
      mode,
      storageKeys,
      profileDeleted,
      unlinked: mode === MY_BAND_REMOVAL_MODES.KEEP ? counts : NO_EVENTS,
      deleted,
      audit: { action: 'my_band.remove', details: { tenantId, bandProfileId: row.band_profile_id, mode } },
    }
  }, { db })

  if (result.error) return result

  // Only now that the rows are gone for good. Reclaiming inside the transaction
  // would leave a rolled-back gig pointing at files that no longer exist.
  for (const key of result.storageKeys) safeRemove(key, 'Failed to delete gig object:')

  // The audit descriptor is a sibling of the payload, never part of it: the
  // route emits one and sends the other.
  return {
    removal: {
      removed: true,
      mode: result.mode,
      unlinked: result.unlinked,
      deleted: result.deleted,
      profileDeleted: result.profileDeleted,
    },
    audit: result.audit,
  }
}

// Validates a my_band_id on an event write and HOLDS a KEY SHARE lock on the
// row for the rest of the caller's transaction, so a concurrent removal blocks
// until that write commits. Without the lock, validation could pass and the
// insert then hit the composite foreign key — a raw 23503 where the caller
// deserves a clean 404.
//
// `undefined` means the write does not mention the link; `null` clears it.
// Both are fine and neither needs a lock.
export async function assertMyBandWritable(client, tenantId, value) {
  if (value === undefined || value === null) return null

  const myBandId = parsePositiveId(value)
  if (myBandId === null) return invalidInput('invalid_my_band_id')

  // 404, not 403: a row in someone else's workspace must be indistinguishable
  // from one that does not exist.
  if (!(await lockMyBandForEventWrite(client, myBandId, tenantId))) {
    return notFound('Band not found in your bands')
  }
  return null
}

// Called from tenant deletion, INSIDE its transaction and after its cascades.
// The foreign keys drop a personal workspace's my_bands rows and a claiming
// tenant's pending claim without running any of the service code above, so a
// profile can fall to zero holders with nothing left to notice. This is what
// notices.
export async function sweepAbandonedProfiles(client, profileIds) {
  let deleted = 0
  for (const profileId of profileIds) {
    if (await deleteBandProfileIfAbandoned(client, profileId)) deleted += 1
  }
  if (deleted > 0) logger.info('band_profile.swept_abandoned', { sweptProfiles: deleted })
  return deleted
}

