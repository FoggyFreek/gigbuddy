// Accounting-profile domain logic: the tenant's accounting REGIME (country,
// legal form, entity size, bases, financial-year start, base currency, VAT
// registration status). Route handlers stay thin and delegate here.
//
// Not to be confused with profileService.js, which is the *band* profile
// (name, bio, images, seller identity for invoices).
//
// This is the record every later compliance capability reads its jurisdiction
// facts from — loadAccountingProfile() is that read primitive.
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { acquireAccountingSettingsLock } from '../repositories/accountRepository.js'
import { fetchTenantVatCountry, updateTenantFields } from '../repositories/tenantRepository.js'
import {
  fetchAccountingProfile,
  insertAccountingProfile,
  updateAccountingProfile,
  markProfileReviewed as markProfileReviewedRow,
} from '../repositories/accountingProfileRepository.js'
import {
  buildAccountingProfileUpdate,
  applyDerivedFields,
  applyVatDependencyRules,
  isProfileComplete,
  profilePresentationState,
} from '../validators/accountingProfileValidators.js'
import { defaultBaseCurrency } from '../../shared/accountingProfileCodes.js'
import { normalizeVatCountry } from '../../shared/vatRates.js'
import { badRequest, conflict, notFound } from './serviceErrors.js'
import { logger } from '../utils/logger.js'

// Fields the profile still shares with the legacy tenants columns while the
// legacy readers are repointed. A profile write keeps the projection in step so
// the previous app container (deployment migrates before replacing it) and any
// un-repointed reader stay correct. Removed when the columns are dropped.
const LEGACY_PROJECTED_FIELDS = ['legal_form']

// Adds the derived presentation state so no consumer re-implements the
// completeness/provenance combination.
function present(profile) {
  return { ...profile, presentation_state: profilePresentationState(profile) }
}

// Creates the profile for a brand-new tenant. Runs inside the caller's tenant
// creation transaction: if this throws, the tenant itself rolls back.
export async function createAccountingProfileForTenant(client, tenantId, countryCode) {
  const inserted = await insertAccountingProfile(client, tenantId, {
    country_code: countryCode,
    base_currency: defaultBaseCurrency(countryCode),
    legal_form: null,
    profile_source: 'tenant_creation',
    profile_status: 'incomplete',
  })
  return inserted ?? fetchAccountingProfile(client, tenantId)
}

// TEMPORARY, remove when the legacy tenants columns are dropped.
//
// Deployment runs migrations while the previous app container is still serving
// (`docker compose run --rm migrate` before `docker compose up -d app`), so that
// container can create a tenant AFTER migration 137's backfill and before the new
// code takes over — leaving a tenant with no profile row that no repair script
// can win a race against. Repairing on read closes that window.
//
// This is only honest while `tenants.vat_country` still exists to derive the
// country from. Once it is dropped there is nothing truthful to fall back on, and
// this must be replaced by a 409 `accounting_profile_missing` plus the
// backfillAccountingProfiles repair script.
// Takes an executor rather than starting its own transaction, so it works both on
// the pool and inside a caller's transaction. It needs no advisory lock: there is
// no read-modify-write to protect, only an idempotent insert of a row derived
// entirely from tenants.vat_country. A concurrent insert lands in ON CONFLICT DO
// NOTHING and the re-read (fresh snapshot under READ COMMITTED) returns the
// winner's row.
async function repairMissingProfile(executor, tenantId) {
  const vatCountry = normalizeVatCountry(await fetchTenantVatCountry(executor, tenantId))
  if (!vatCountry) return null

  const inserted = await insertAccountingProfile(executor, tenantId, {
    country_code: vatCountry,
    base_currency: defaultBaseCurrency(vatCountry),
    legal_form: null,
    profile_source: 'repair',
    profile_status: 'incomplete',
  })
  if (inserted) logger.warn('accounting_profile.repaired', { tenantId, operation: 'lazy_repair' })
  return inserted ?? fetchAccountingProfile(executor, tenantId)
}

export async function getAccountingProfile(db, tenantId) {
  const profile = await loadAccountingProfile(db, tenantId)
  if (!profile) return notFound('Accounting profile not found')
  return { profile: present(profile) }
}

// The read primitive for every downstream consumer of the accounting regime.
// Returns the row (repairing a missing one) or null when the tenant is gone.
export async function loadAccountingProfile(executor, tenantId) {
  const existing = await fetchAccountingProfile(executor, tenantId)
  if (existing) return existing
  return repairMissingProfile(executor, tenantId)
}

export async function patchAccountingProfile(db, tenantId, body = {}) {
  // Country is immutable after creation, and not merely until the first posting:
  // changing it must also reset and revalidate the VAT id, business registration,
  // default rate, base currency, local legal form, reporting framework and any
  // drafts configured for the old country. A plain field write would leave the
  // record internally inconsistent, so that belongs in a dedicated transactional
  // operation, not here.
  if ('country_code' in body) {
    return conflict('Accounting country cannot be changed', { code: 'country_immutable' })
  }
  if ('base_currency' in body) {
    return badRequest('base_currency_derived_from_country')
  }

  return withTransaction(async (client) => {
    // Serialize against ledger postings and accounting-settings changes, which
    // take the same lock.
    await acquireAccountingSettingsLock(client, tenantId)

    const current = await fetchAccountingProfile(client, tenantId)
    if (!current) abortTransaction(notFound('Accounting profile not found'))

    const built = buildAccountingProfileUpdate(body, {
      countryCode: current.country_code,
      current,
    })
    if (built.error) abortTransaction(badRequest(built.error))

    const { updates } = built
    if (Object.keys(updates).length === 0) {
      abortTransaction(badRequest('nothing_to_update'))
    }

    applyDerivedFields(updates, current, current.country_code)

    const vatError = applyVatDependencyRules(updates, current)
    if (vatError) abortTransaction(badRequest(vatError))

    // Completeness is derived, never client-supplied.
    updates.profile_status = isProfileComplete({ ...current, ...updates }) ? 'complete' : 'incomplete'

    const updated = await updateAccountingProfile(client, tenantId, updates)
    if (!updated) abortTransaction(notFound('Accounting profile not found'))

    await projectToLegacyColumns(client, tenantId, updates, current)

    return { profile: present(updated) }
  }, { db })
}

// Keeps the legacy tenants columns in step during the expand phase.
//
// `applies_kor` is projected from the filing frequency rather than being asked
// separately: a small-business-scheme participant is exactly a registered band that
// does not file, so two controls for one fact would be a duplicate that can
// disagree. The flag is the one that actually suppresses VAT on invoices
// (shared/invoiceTotals.js), so the visible answer has to drive it.
//
// It is only set for the Netherlands. The KOR is a Dutch national scheme —
// korApplies() in shared/vatRates.js gates on that — and the equivalent schemes in
// the other packs are not implemented, so recording the flag for them would claim
// VAT suppression the invoice code does not perform. The UI says so.
async function projectToLegacyColumns(client, tenantId, updates, current) {
  const fields = []
  const values = []
  for (const key of LEGACY_PROJECTED_FIELDS) {
    if (!(key in updates)) continue
    fields.push(`${key} = $${fields.length + 1}`)
    values.push(updates[key])
  }

  if ('vat_filing_frequency' in updates) {
    const exempt = updates.vat_filing_frequency === 'exempt'
      && normalizeVatCountry(current.country_code) === 'nl'
    fields.push(`applies_kor = $${fields.length + 1}`)
    values.push(exempt)
  }

  if (fields.length) await updateTenantFields(client, tenantId, fields, values)
}

// Records that a human confirmed the profile. Only meaningful once every field is
// answered — confirming an incomplete profile would assert a review that did not
// happen.
export async function markProfileReviewed(db, tenantId, userId) {
  return withTransaction(async (client) => {
    await acquireAccountingSettingsLock(client, tenantId)

    const current = await fetchAccountingProfile(client, tenantId)
    if (!current) abortTransaction(notFound('Accounting profile not found'))
    if (current.profile_status !== 'complete') {
      abortTransaction(conflict('Complete the profile before confirming it', { code: 'profile_incomplete' }))
    }

    const updated = await markProfileReviewedRow(client, tenantId, userId)
    return { profile: present(updated) }
  }, { db })
}
