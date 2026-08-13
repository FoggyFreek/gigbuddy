// A band tenant asking to be recognised as the owner of a global band profile.
//
// Verification happens offline — email from the band's domain, proof of
// ownership, whatever a super admin is satisfied by — so this file only manages
// the request, never decides it. The decision lives in
// adminBandProfileClaimService.js.
//
// Invariants:
//   - a tenant sees ONLY its own claim, never the queue and never who else
//     wants the same profile;
//   - a claim freezes the profile, so the facts being verified cannot change
//     underneath the reviewer;
//   - locks are taken tenants -> band_profiles -> claims, the order tenant
//     deletion already imposes.
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { lockTenantRow } from '../workspaces/tenantRepository.js'
import { parseClaimMessage } from './bandProfileValidators.js'
import { parsePositiveId } from '../../platform/http/requestValidators.js'
import { CLAIM_STATUSES } from '../../domain/bandProfiles.js'
import {
  lockBandProfile,
  hasPendingClaim,
} from './bandProfileRepository.js'
import {
  insertClaim,
  fetchClaim,
  fetchClaimForTenant,
  lockClaim,
  deletePendingClaim,
} from './bandProfileClaimRepository.js'
import { invalidInput } from './bandProfileService.js'
import { conflict, notFound } from '../../platform/http/serviceErrors.js'

const NOT_FOUND = notFound('Claim not found')

// The profile is nullable on purpose: terminal deletion removes an abandoned
// profile while its decided claim survives as the record of the decision, and
// the name snapshot is what keeps that row readable.
export function shapeClaim(row) {
  return {
    id: row.id,
    bandProfileId: row.band_profile_id,
    bandProfileName: row.band_profile_name,
    status: row.status,
    message: row.message,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }
}

export async function getOwnClaim(db, tenantId) {
  const row = await fetchClaimForTenant(db, tenantId)
  return { claim: row ? shapeClaim(row) : null }
}

export async function requestClaim(db, user, tenantId, body) {
  const profileId = parsePositiveId(body?.bandProfileId ?? body?.band_profile_id)
  if (profileId === null) return invalidInput('invalid_band_profile_id')

  const parsedMessage = parseClaimMessage(body?.message)
  if (parsedMessage.error) return invalidInput(parsedMessage.error)

  return withTransaction(async (client) => {
    await lockTenantRow(client, tenantId)

    const profile = await lockBandProfile(client, profileId)
    if (!profile) abortTransaction(notFound('Band profile not found'))

    if (profile.claimed_by_tenant_id !== null) {
      abortTransaction(conflict('This band profile has already been claimed', {
        code: 'band_profile_already_claimed',
      }))
    }

    // The caller's own claim is checked FIRST. Otherwise re-submitting an
    // unchanged claim trips the "someone else is claiming this" guard below on
    // the caller's own row, and a harmless retry looks like a conflict.
    const existing = await fetchClaimForTenant(client, tenantId)
    if (existing?.status === CLAIM_STATUSES.PENDING) {
      if (existing.band_profile_id === profileId) {
        return { created: false, claim: shapeClaim(existing) }
      }
      abortTransaction(conflict('This band is already claiming a profile', {
        code: 'tenant_already_claiming',
      }))
    }
    if (existing?.status === CLAIM_STATUSES.APPROVED) {
      abortTransaction(conflict('This band is already claiming a profile', {
        code: 'tenant_already_claiming',
      }))
    }

    // Deliberately does NOT say which tenant is claiming it: that a claim
    // exists is all the caller needs, and all they are owed.
    if (await hasPendingClaim(client, profileId)) {
      abortTransaction(conflict('Someone is already claiming this band profile', {
        code: 'claim_pending_elsewhere',
      }))
    }

    const claimId = await insertClaim(client, {
      profileId,
      profileName: profile.name,
      tenantId,
      userId: user.id,
      message: parsedMessage.text,
    })

    return {
      created: true,
      claim: shapeClaim(await fetchClaim(client, claimId)),
      // The message is free text from an unverified claimant; `bandProfileId`
      // is safe in an audit trail, the message is not.
      audit: { action: 'band_profile_claim.request', details: { tenantId, bandProfileId: profileId, claimId } },
    }
  }, { db, mapError: mapClaimConflict })
}

// Withdrawing matters: without it a band that claimed the wrong profile would
// be stuck, since one live claim per tenant is a hard constraint.
export async function withdrawClaim(db, tenantId, claimId) {
  return withTransaction(async (client) => {
    await lockTenantRow(client, tenantId)

    const claim = await lockClaim(client, claimId)
    // Not this tenant's, already decided, or never existed — none of them is
    // this endpoint's business, and all look the same from outside.
    if (!claim || claim.tenant_id !== tenantId || claim.status !== CLAIM_STATUSES.PENDING) {
      abortTransaction(NOT_FOUND)
    }

    if (claim.band_profile_id !== null) await lockBandProfile(client, claim.band_profile_id)
    // Only the claim goes: the profile returns to claimable and stays in the
    // directory, holders or none.
    await deletePendingClaim(client, claimId, tenantId)

    return { audit: { action: 'band_profile_claim.withdraw', details: { tenantId, claimId } } }
  }, { db })
}

// The partial unique indexes are the backstop for the windows the locks above
// already close; a 23505 here means a concurrent writer won a race we lost.
function mapClaimConflict(err) {
  if (err.code !== '23505') return null
  if (err.constraint === 'band_profile_claims_one_live_per_tenant') {
    return conflict('This band is already claiming a profile', { code: 'tenant_already_claiming' })
  }
  return conflict('Someone is already claiming this band profile', { code: 'claim_pending_elsewhere' })
}
