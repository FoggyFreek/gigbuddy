// Super-admin review of band-profile claims.
//
// The verification itself is manual and offline; this file records the outcome
// and applies its consequences. Two of those consequences are easy to miss:
//
//   - a decision never deletes the profile. Approval points it at the real
//     tenant and rejection releases it back to claimable; either way the
//     directory entry stays, holders or none, so the band keeps being findable;
//   - the artists who have been tagging events against the profile need telling
//     that the band is on gigbuddy now, because their next step is to join it.
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import {
  limitedCollectionWithTimestampCursor,
  limitedCollectionWithTimestampCursorAndTotal,
} from '../../platform/collections/limitedCollectionService.js'
import { parseTimestampCursor, parseListLimit } from '../../platform/http/requestValidators.js'
import { parseUnclaimedProfileListQuery } from './adminBandProfileClaimValidators.js'
import { logger } from '../../utils/logger.js'
import { CLAIM_STATUSES } from '../../domain/bandProfiles.js'
import { parseDecisionReason } from '../../people/band-profiles/bandProfileValidators.js'
import { lockTenantRow, fetchTenantArchiveState } from '../../people/workspaces/tenantRepository.js'
import {
  lockBandProfile,
  setClaimedTenant,
  deleteBandProfile,
  hasPendingClaim,
  fetchBandProfile,
  listUnclaimedBandProfiles,
} from '../../people/band-profiles/bandProfileRepository.js'
import { listHolderTenantIds, countHolders } from '../../people/my-bands/myBandRepository.js'
import {
  listClaims,
  listProfileUsersForClaims,
  fetchClaim,
  lockClaim,
  peekClaimTargets,
  decideClaim,
} from '../../people/band-profiles/bandProfileClaimRepository.js'
import { shapeClaim } from '../../people/band-profiles/bandProfileClaimService.js'
import { shapeBandProfile, invalidInput } from '../../people/band-profiles/bandProfileService.js'
import { dispatchNotification } from '../../user/notifications/notificationService.js'
import { conflict, notFound } from '../../platform/http/serviceErrors.js'

const NOT_FOUND = notFound('Claim not found')
const VALID_STATUS_FILTERS = new Set(Object.values(CLAIM_STATUSES))

// The admin view may name the tenant — that is the whole point of a review
// queue — but it stays separate from the public shaper so the two can never be
// confused for one another.
function shapeProfileUser(row) {
  return {
    id: row.user_id,
    name: row.user_name,
    email: row.user_email,
    requestingTenantMembership: row.membership_status
      ? { status: row.membership_status, role: row.membership_role }
      : null,
  }
}

function shapeAdminClaim(row, profileUsers = []) {
  return {
    ...shapeClaim(row),
    tenant: {
      id: row.tenant_id,
      slug: row.tenant_slug,
      displayName: row.tenant_display_name,
      kind: row.tenant_kind,
      archived: row.tenant_archived_at !== null,
      socials: {
        instagram: row.tenant_instagram_handle,
        facebook: row.tenant_facebook_handle,
        tiktok: row.tenant_tiktok_handle,
        youtube: row.tenant_youtube_handle,
        spotify: row.tenant_spotify_handle,
      },
    },
    requestedBy: row.requested_by_email
      ? { email: row.requested_by_email, name: row.requested_by_name }
      : null,
    profileUsers,
    decidedBy: row.decided_by_email
      ? { email: row.decided_by_email, name: row.decided_by_name }
      : null,
    // Present only while the profile still exists; a decided claim outlives it.
    bandProfile: row.band_profile_id === null ? null : {
      id: row.band_profile_id,
      name: row.band_profile_name,
      countryCode: row.country_code,
      spotifyUrl: row.spotify_url,
      websiteUrl: row.website_url,
      contactEmail: row.contact_email,
    },
  }
}

export async function listQueue(db, query) {
  const status = query?.status ?? null
  if (status !== null && !VALID_STATUS_FILTERS.has(status)) return invalidInput('invalid_status')

  const parsedCursor = parseTimestampCursor(query)
  if (parsedCursor === null) return invalidInput('invalid_cursor')

  // Parsed here as well so a malformed limit is a 400 before any query runs.
  if (parseListLimit(query?.limit) === null) return invalidInput('invalid_limit')

  const result = await limitedCollectionWithTimestampCursor(
    query?.limit,
    (limit) => listClaims(db, { status, limit, cursor: parsedCursor.cursor }),
    (row) => row.created_at,
  )
  if (result.error) return result

  const profileUserRows = await listProfileUsersForClaims(db, result.items.map((row) => row.id))
  const profileUsersByClaim = new Map()
  for (const row of profileUserRows) {
    const users = profileUsersByClaim.get(row.claim_id) ?? []
    users.push(shapeProfileUser(row))
    profileUsersByClaim.set(row.claim_id, users)
  }

  return {
    ...result,
    items: result.items.map((row) => shapeAdminClaim(row, profileUsersByClaim.get(row.id) ?? [])),
  }
}

export async function listUnclaimedProfiles(db, query) {
  const parsed = parseUnclaimedProfileListQuery(query)
  if (parsed.error) return invalidInput(parsed.error)

  const result = await limitedCollectionWithTimestampCursorAndTotal(
    parsed.limit,
    (limit) => listUnclaimedBandProfiles(db, { limit, cursor: parsed.cursor }),
    (row) => row.cursor_at,
  )
  if (result.error) return result

  return {
    ...result,
    items: result.items.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: row.member_count,
      createdAt: row.created_at,
    })),
  }
}

export async function deleteUnclaimedProfile(db, profileId) {
  return withTransaction(async (client) => {
    const profile = await lockBandProfile(client, profileId)
    if (!profile) abortTransaction(notFound('Band profile not found'))

    if (profile.claimed_by_tenant_id !== null) {
      abortTransaction(conflict('A band has been granted this profile', { code: 'profile_claimed' }))
    }
    if (await hasPendingClaim(client, profileId)) {
      abortTransaction(conflict('Decide the pending claim on this profile first', {
        code: 'claim_pending',
      }))
    }

    // Recorded because the cascade is invisible afterwards: this many personal
    // workspaces lose the band from their collection, and their events lose the
    // tag that named it.
    const holders = await countHolders(client, profileId)
    await deleteBandProfile(client, profileId)

    return {
      audit: { action: 'band_profile.delete', details: { bandProfileId: profileId, holders } },
    }
  }, { db })
}

export async function approveClaim(db, adminUser, claimId) {
  return decide(db, adminUser, claimId, { status: CLAIM_STATUSES.APPROVED, reason: null })
}

export async function rejectClaim(db, adminUser, claimId, body) {
  // A rejection without a reason is unactionable for the band that has to fix
  // whatever was wrong.
  const parsed = parseDecisionReason(body?.reason, { required: true })
  if (parsed.error) return invalidInput('reason_required')
  return decide(db, adminUser, claimId, { status: CLAIM_STATUSES.REJECTED, reason: parsed.text })
}

async function decide(db, adminUser, claimId, { status, reason }) {
  // Read the targets unlocked, purely to learn which rows to lock and in which
  // order: tenants -> band_profiles -> claims. Whatever this returns is
  // re-validated under the locks below, so a stale read here is harmless.
  const targets = await peekClaimTargets(db, claimId)
  if (!targets) return NOT_FOUND

  const result = await withTransaction(async (client) => {
    await lockTenantRow(client, targets.tenant_id)
    if (targets.band_profile_id !== null) await lockBandProfile(client, targets.band_profile_id)

    const claim = await lockClaim(client, claimId)
    if (!claim) abortTransaction(NOT_FOUND)
    if (claim.status !== CLAIM_STATUSES.PENDING) {
      abortTransaction(conflict('This claim has already been decided', {
        code: 'claim_not_pending', status: claim.status,
      }))
    }

    // A queue row is a hint, never authorization: the tenant may have been
    // archived or deleted while the claim sat waiting, and approving into a
    // dead tenant would strand the profile permanently.
    const tenant = await fetchTenantArchiveState(client, claim.tenant_id)
    if (!tenant || tenant.archived_at !== null || tenant.kind !== 'band') {
      abortTransaction(conflict('That band is no longer available', { code: 'tenant_unavailable' }))
    }

    await decideClaim(client, claimId, { status, reason, decidedByUserId: adminUser.id })

    if (status !== CLAIM_STATUSES.APPROVED) {
      // Rejection only releases the profile back to claimable; the directory
      // entry itself stays, so the band can fix whatever was wrong and retry.
      return {
        claim: shapeClaim(await fetchClaim(client, claimId)),
        notify: { tenantId: claim.tenant_id, status, profileName: claim.band_profile_name },
        audit: { action: 'band_profile_claim.reject', details: { claimId, tenantId: claim.tenant_id } },
      }
    }

    // The profile could have been deleted by its last holder while the claim
    // was pending; there is then nothing left to claim.
    if (claim.band_profile_id === null) {
      abortTransaction(conflict('That band profile no longer exists', { code: 'band_profile_gone' }))
    }

    await setClaimedTenant(client, claim.band_profile_id, claim.tenant_id)

    const holderTenantIds = await listHolderTenantIds(client, claim.band_profile_id)

    return {
      claim: shapeClaim(await fetchClaim(client, claimId)),
      profile: shapeBandProfile(await fetchBandProfile(client, claim.band_profile_id)),
      notify: {
        tenantId: claim.tenant_id,
        status,
        profileName: claim.band_profile_name,
        holderTenantIds,
      },
      audit: {
        action: 'band_profile_claim.approve',
        details: { claimId, tenantId: claim.tenant_id, bandProfileId: claim.band_profile_id },
      },
    }
  }, { db })

  if (result.error) return result

  await notifyDecision(result.notify)
  return result
}

// Post-commit, and unbounded only in theory: a profile has at most five
// holders (MAX_HOLDERS_PER_PROFILE), so this loop is at most six dispatches and
// needs no batching or truncation.
async function notifyDecision({ tenantId, status, profileName, holderTenantIds = [] }) {
  const approved = status === CLAIM_STATUSES.APPROVED

  await dispatchNotification({
    tenantId,
    type: 'band-profile-claim-decided',
    title: approved ? 'Your band profile claim was approved' : 'Your band profile claim was rejected',
    body: profileName,
    url: '/settings/band-profile',
    sourceType: 'band_profile_claim',
    sourceId: null,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))

  if (!approved) return

  for (const holderTenantId of holderTenantIds) {
    // Each holder is a personal workspace of one; the notification tells the
    // artist their band is on gigbuddy so they can join it.
    await dispatchNotification({
      tenantId: holderTenantId,
      type: 'band-profile-claimed',
      title: `${profileName} is on gigbuddy now`,
      body: 'You can ask to join the band and keep your events in one place.',
      url: '/my-bands',
      sourceType: 'band_profile',
      sourceId: null,
    }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId: holderTenantId }))
  }
}
