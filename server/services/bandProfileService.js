// Global band profiles: bands that are not gigbuddy customers.
//
// Invariants this file exists to protect:
//   - the claiming tenant's id NEVER leaves here unless that tenant is
//     discoverable, because it is the input to the join-request and avatar
//     endpoints and would otherwise disclose a private tenant's existence;
//   - only the creator edits, and only while nobody is claiming the profile —
//     a claim freezes it so the facts a super admin verified cannot change
//     underneath them;
//   - "at least one link" is a POST-MERGE invariant: a PATCH clearing the last
//     link is only visible against the stored row, so it is checked inside the
//     transaction, never in the validator.
//
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { limitedCollection } from './limitedCollectionService.js'
import { parseDiscoverySearch } from '../validators/common.js'
import {
  parseBandProfilePatch,
  parseWebsiteUrl,
  hasLink,
} from '../validators/bandProfileValidators.js'
import {
  searchBandProfiles as searchBandProfileRows,
  fetchBandProfile,
  lockBandProfile,
  updateBandProfile,
  hasPendingClaim,
} from '../repositories/bandProfileRepository.js'
import { badRequest, conflict, forbidden, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Band profile not found')

// Validation failures carry a machine-readable `code` alongside human copy: the
// add-band dialog switches on it to point at the offending field.
const INPUT_MESSAGES = Object.freeze({
  query_too_short: 'Search for at least 3 characters',
  query_too_long: 'Search query is too long',
  invalid_limit: 'limit must be a positive integer',
  invalid_body: 'Request body must be an object',
  no_fields_to_update: 'No fields to update',
  name_required: 'A band name is required',
  name_too_long: 'Band name is too long',
  invalid_country: 'Pick a country from the list',
  invalid_spotify_url: 'That is not a Spotify artist link',
  invalid_website_url: 'That is not a valid website address',
  website_url_too_long: 'Website address is too long',
  invalid_email: 'That is not a valid email address',
  band_profile_needs_link: 'A band profile needs a Spotify link or a website',
  invalid_band_profile_id: 'Invalid band profile id',
  band_profile_required: 'Provide a band profile id or a new band profile',
  invalid_mode: 'mode must be "keep" or "delete"',
  invalid_my_band_id: 'Invalid band reference',
  invalid_claim_message: 'Message is too long',
  invalid_decision_reason: 'Reason is too long',
  reason_required: 'A reason is required when rejecting a claim',
  invalid_status: 'Unknown claim status',
  invalid_cursor: 'cursor must be a value returned as meta.nextCursor',
})

export function invalidInput(code) {
  return badRequest(INPUT_MESSAGES[code] ?? 'Invalid request', { code })
}

// ---------- shaping ----------
//
// The single exit for a profile payload. Every surface that returns one — search,
// detail, the profile nested in a My Bands row, the profile echoed by a claim —
// goes through here, so there is exactly one place to audit for a leak.
export function shapeBandProfile(row) {
  return {
    id: row.id,
    name: row.name,
    countryCode: row.country_code,
    spotifyUrl: row.spotify_url,
    websiteUrl: row.website_url,
    contactEmail: row.contact_email,
    status: row.status,
    claimed: row.claimed,
    // Populated by the repository only when the claiming tenant is discoverable.
    claimedTenant: row.claimed_tenant ?? null,
    createdAt: row.created_at,
    ...(row.website_match === undefined ? {} : { websiteMatch: row.website_match }),
  }
}

// A creator may edit while the profile is unclaimed. Super admins may edit
// regardless — they are the repair path when a creator's account is gone.
export function canEditBandProfile(row, user) {
  if (user?.is_super_admin) return true
  if (row.created_by_user_id === null) return false
  return row.created_by_user_id === user?.id && row.status === 'claimable'
}

// ---------- reads ----------

// Two match inputs, because the dialog needs them at different moments: the
// artist types a name first, then a website in the create form. A website hit
// is returned as an ordinary result flagged websiteMatch, never as an error —
// see the migration note on why website identity is advisory.
export async function searchProfiles(db, query) {
  const parsed = parseDiscoverySearch(query, { requireQuery: false })
  if (parsed.error) return invalidInput(parsed.error)

  const website = parseWebsiteUrl(query?.website)
  if (website.error) return invalidInput(website.error)

  // Either input alone is a search; neither is not.
  if (parsed.query === '' && website.key === null) return invalidInput('query_too_short')

  const result = await limitedCollection(parsed.limit, (limit) => searchBandProfileRows(db, {
    query: parsed.query === '' ? null : parsed.query,
    websiteKey: website.key,
    limit,
  }))
  if (result.error) return result

  return { ...result, items: result.items.map(shapeBandProfile) }
}

export async function getProfile(db, user, profileId) {
  const row = await fetchBandProfile(db, profileId)
  if (!row) return NOT_FOUND
  return { profile: { ...shapeBandProfile(row), canEdit: canEditBandProfile(row, user) } }
}

// ---------- writes ----------

export async function patchProfile(db, user, profileId, body) {
  const parsed = parseBandProfilePatch(body)
  if (parsed.error) return invalidInput(parsed.error)

  return withTransaction(async (client) => {
    // Profile-only write: no tenant is involved, so this takes the head of the
    // lock order and nothing else.
    const current = await lockBandProfile(client, profileId)
    if (!current) abortTransaction(NOT_FOUND)

    const denial = await authorizeEdit(client, current, user, profileId)
    if (denial) abortTransaction(denial)

    // The rule is about the row that will exist, not the payload that arrived.
    const merged = { ...current, ...parsed.patch }
    if (!hasLink(merged)) abortTransaction(invalidInput('band_profile_needs_link'))

    await updateBandProfile(client, profileId, parsed.patch)

    return {
      profile: shapeBandProfile(await fetchBandProfile(client, profileId)),
      audit: { action: 'band_profile.update', details: { bandProfileId: profileId } },
    }
  }, { db, mapError: mapDuplicate })
}

async function authorizeEdit(client, current, user, profileId) {
  if (user?.is_super_admin) return null

  // 403, not 404: the caller can already read this row, so concealing it here
  // would be theatre.
  if (current.created_by_user_id === null || current.created_by_user_id !== user?.id) {
    return forbidden('Only the creator of this band profile can edit it', {
      code: 'not_profile_creator',
    })
  }

  // A claim freezes the facts a super admin is verifying offline. 409 rather
  // than 403: nothing is hidden, the row is simply not editable right now. The
  // profile row is already locked, so neither check can go stale under us.
  if (current.claimed_by_tenant_id !== null || await hasPendingClaim(client, profileId)) {
    return conflict('This band profile is being claimed and cannot be edited', {
      code: 'band_profile_locked',
    })
  }
  return null
}

// The one hard dedup key. A collision means the artist is looking at a band
// that already exists, so the id rides along for the dialog to offer it.
export function mapDuplicate(err) {
  if (err.code !== '23505') return null
  if (err.constraint === 'band_profiles_spotify_artist_key') {
    return conflict('A profile for this Spotify artist already exists', {
      code: 'band_profile_duplicate',
    })
  }
  return null
}
