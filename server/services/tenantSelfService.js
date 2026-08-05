// Self-service tenant management: any approved user can create tenants they
// own, list them, and archive/unarchive them. The owner's subscription band
// limit caps how many ACTIVE (non-archived) tenants a user owns; archived
// tenants keep their data but don't count. Super-admin tenant management
// (uncapped, ownerless creation) stays in tenantService.js.
//
// Ownership checks return 404, never 403, so tenant existence isn't leaked.
import { randomBytes } from 'node:crypto'
import { validSlug, slugFromBandName, parseTenantCountryCode } from '../validators/tenantValidators.js'
import { seedTenantAccounting } from '../db/defaultChartOfAccounts.js'
import { createAccountingProfileForTenant } from './accountingProfileService.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import {
  insertTenant,
  insertTenantIfSlugFree,
  ensureTenantStatistics,
  insertTenantAdminMembership,
  listOwnedTenants as listOwnedTenantRows,
  fetchOwnedTenant,
  fetchPersonalTenant,
  setTenantArchived,
} from '../repositories/tenantRepository.js'
import { lockUserForCapCheck } from '../repositories/limitRepository.js'
import { setOnboardingTenant } from '../repositories/authRepository.js'
import { enforceBandCap } from './limitService.js'
import { isTenantOnboardingEnabled } from './platformSettingsService.js'
import { badRequest, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Tenant not found')

const BAND = 'band'
const PERSONAL = 'personal'

// One platform switch governs all self-service tenant creation, whichever kind.
const ONBOARDING_DISABLED = {
  error: {
    status: 403,
    body: {
      error: 'Tenant onboarding is disabled',
      code: 'tenant_onboarding_disabled',
    },
  },
}

// Fallback when the identity provider gave us no name — the owner renames it
// from their profile like any other tenant.
const PERSONAL_WORKSPACE_FALLBACK_NAME = 'My workspace'

function personalWorkspaceName(user, body) {
  const requested = typeof body?.display_name === 'string' ? body.display_name.trim() : ''
  return requested || String(user?.name ?? '').trim() || PERSONAL_WORKSPACE_FALLBACK_NAME
}

// How many "-2".."-N" suffixes to try for a generated slug before falling
// back to a random suffix (a pathological hot name, still one insert).
const SLUG_SUFFIX_ATTEMPTS = 25

// Inserts with a server-generated slug: base, base-2, base-3, … each via
// ON CONFLICT DO NOTHING so a taken slug never raises 23505 (which would
// abort the surrounding transaction). Returns the inserted tenant row.
async function insertWithGeneratedSlug(client, displayName, userId, kind = BAND) {
  const base = slugFromBandName(displayName)
  const attrs = { displayName, kind, createdByUserId: userId, ownerUserId: userId }
  for (let n = 1; n <= SLUG_SUFFIX_ATTEMPTS; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    const tenant = await insertTenantIfSlugFree(client, { ...attrs, slug: candidate })
    if (tenant) return tenant
  }
  return insertTenantIfSlugFree(
    client, { ...attrs, slug: `${base}-${randomBytes(3).toString('hex')}` },
  )
}

// Creates a tenant owned by the caller, who becomes its tenant_admin. The
// band cap is checked under a user-row lock in the same transaction as the
// insert, so two parallel creates can't both slip under the limit. When no
// slug is supplied, one is generated from band_name (deduped with -2/-3…).
// `onboarding: true` records the tenant as the caller's onboarding resume
// pointer in the same transaction.
export async function createOwnedTenant(db, userId, body) {
  const { slug, band_name, onboarding } = body || {}
  const hasSlug = slug !== undefined && slug !== null && slug !== ''
  if (hasSlug && !validSlug(slug)) return badRequest('Invalid slug')
  if (!band_name || typeof band_name !== 'string') {
    return badRequest('band_name is required')
  }
  const country = parseTenantCountryCode(body)
  if (country.error) return badRequest(country.error)
  if (!(await isTenantOnboardingEnabled(db))) return ONBOARDING_DISABLED

  return withTransaction(async (client) => {
    const capError = await enforceBandCap(client, userId)
    if (capError) abortTransaction(capError)

    const tenant = hasSlug
      ? await insertTenant(client, {
        slug, displayName: band_name, createdByUserId: userId, ownerUserId: userId,
      })
      : await insertWithGeneratedSlug(client, band_name, userId)
    if (!tenant) {
      // Even the random-suffix fallback collided — effectively impossible.
      abortTransaction({ error: { status: 409, body: { error: 'Slug already in use' } } })
    }
    await ensureTenantStatistics(client, tenant.id)
    await seedTenantAccounting(client, tenant.id)
    // Same transaction as the tenant insert: a band must never exist without the
    // accounting profile that states its jurisdiction.
    await createAccountingProfileForTenant(client, tenant.id, country.countryCode)
    await insertTenantAdminMembership(client, userId, tenant.id, userId)
    if (onboarding === true) {
      await setOnboardingTenant(client, userId, tenant.id)
    }

    return {
      tenant,
      audit: { action: 'tenant.self_create', details: { tenantId: tenant.id } },
    }
  }, {
    db,
    mapError: (err) => (err.code === '23505'
      ? { error: { status: 409, body: { error: 'Slug already in use' } } }
      : null),
  })
}

// The musician's own workspace: an ordinary tenant the UI presents as "me".
// A sole trader by construction, one approved member (the owner), outside the
// band cap. Idempotent — a caller who already owns one gets it back, so a
// retried or resumed onboarding never creates a second.
//
// Takes the loaded user rather than an id: the workspace is named after them.
export async function createPersonalTenant(db, user, body) {
  const existing = await fetchPersonalTenant(db, user.id)
  if (existing) return { tenant: existing, created: false }

  const country = parseTenantCountryCode(body)
  if (country.error) return badRequest(country.error)
  if (!(await isTenantOnboardingEnabled(db))) return ONBOARDING_DISABLED

  const displayName = personalWorkspaceName(user, body)

  return withTransaction(async (client) => {
    // Same user-row lock the band cap takes, here to serialize the
    // fetch-then-insert idempotency check against a concurrent create. The
    // partial unique index is the backstop, not the primary defense.
    await lockUserForCapCheck(client, user.id)
    const raced = await fetchPersonalTenant(client, user.id)
    if (raced) abortTransaction({ tenant: raced, created: false })

    const tenant = await insertWithGeneratedSlug(client, displayName, user.id, PERSONAL)
    if (!tenant) {
      abortTransaction({ error: { status: 409, body: { error: 'Slug already in use' } } })
    }
    await ensureTenantStatistics(client, tenant.id)
    await seedTenantAccounting(client, tenant.id)
    await createAccountingProfileForTenant(client, tenant.id, country.countryCode, {
      legalForm: 'sole_trader',
    })
    await insertTenantAdminMembership(client, user.id, tenant.id, user.id)
    if (body?.onboarding === true) {
      await setOnboardingTenant(client, user.id, tenant.id)
    }

    return {
      tenant,
      created: true,
      audit: { action: 'tenant.self_create_personal', details: { tenantId: tenant.id } },
    }
  }, {
    db,
    // tenants_one_personal_per_owner or the slug index — both mean someone else
    // won the race the user-row lock is there to prevent.
    mapError: (err) => (err.code === '23505'
      ? { error: { status: 409, body: { error: 'Workspace already exists' } } }
      : null),
  })
}

export async function listOwnedTenants(db, userId) {
  return listOwnedTenantRows(db, userId)
}

export async function archiveOwnedTenant(db, userId, tenantId) {
  const tenant = await fetchOwnedTenant(db, tenantId, userId)
  if (!tenant) return NOT_FOUND
  const archived = await setTenantArchived(db, tenantId, true)
  return {
    tenant: archived,
    audit: { action: 'tenant.archive', details: { tenantId } },
  }
}

// Unarchiving makes the tenant active again, so the band cap is re-checked —
// archiving must not be a loophole to park bands above the limit and swap
// them back in.
export async function unarchiveOwnedTenant(db, userId, tenantId) {
  return withTransaction(async (client) => {
    // Cap first: enforceBandCap locks the user row, serializing this with any
    // concurrent create/unarchive by the same user.
    const capError = await enforceBandCap(client, userId)

    const tenant = await fetchOwnedTenant(client, tenantId, userId)
    if (!tenant) abortTransaction(NOT_FOUND)
    if (!tenant.archived_at) abortTransaction({ tenant }) // already active — idempotent
    if (capError) abortTransaction(capError)

    const unarchived = await setTenantArchived(client, tenantId, false)
    return {
      tenant: unarchived,
      audit: { action: 'tenant.unarchive', details: { tenantId } },
    }
  }, { db })
}
