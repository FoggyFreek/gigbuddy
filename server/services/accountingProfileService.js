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
import { resolveCurrentSalesTreatment } from './vatTreatmentService.js'
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

  // The sales treatment in force TODAY, resolved from the scheme enrolment
  // rather than read off tenants.applies_kor. The invoice form previews VAT with
  // it, so a scheme scheduled to start or end shows up on its boundary date
  // instead of whenever something last wrote the projection.
  const currentSalesTreatment = await resolveCurrentSalesTreatment(db, tenantId)
  return { profile: { ...present(profile), current_sales_treatment: currentSalesTreatment } }
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

    // Before the VAT cascade: "you cannot set this field at all" outranks
    // "this value needs registration", which the cascade would answer first.
    assertFilingFrequencyNotRequested(body, current)

    const vatError = applyVatDependencyRules(updates, current)
    if (vatError) abortTransaction(badRequest(vatError))

    assertSchemeExemptNotCleared(current, updates)

    // Completeness is derived, never client-supplied.
    updates.profile_status = isProfileComplete({ ...current, ...updates }) ? 'complete' : 'incomplete'

    const updated = await updateAccountingProfile(client, tenantId, updates)
    if (!updated) abortTransaction(notFound('Accounting profile not found'))

    await projectToLegacyColumns(client, tenantId, updates)

    return { profile: present(updated) }
  }, { db })
}

// 'exempt' is DERIVED from the tenant's VAT scheme enrolment, not answered here.
// The scheme carries dates, a jurisdiction and a confirmation, and issued
// documents snapshot its outcome — a plain field write has none of that, and two
// controls for one fact could disagree. So the enrolment editor owns it:
// taxSchemeEnrolmentService.syncSchemeProjections is the only writer.
//
// Both directions are refused, including the value the vat_registered cascade
// would derive, so the field can never drift away from the enrolment behind the
// user's back.
// The two directions a client could ask for, both refused before the VAT
// cascade gets a chance to answer the less specific "that value needs
// registration" — "you cannot set this field at all" is the more actionable
// message and points at the control that does own it.
function assertFilingFrequencyNotRequested(body, current) {
  if (body.vat_filing_frequency === 'exempt') {
    abortTransaction(conflict('Start a VAT scheme enrolment instead', {
      code: 'filing_frequency_derived_from_scheme',
    }))
  }
  if (current.vat_filing_frequency === 'exempt' && 'vat_filing_frequency' in body) {
    abortTransaction(conflict('End the VAT scheme enrolment instead', {
      code: 'filing_frequency_derived_from_scheme',
    }))
  }
}

// Catches the value the vat_registered cascade DERIVES, which no body check can
// see: a KOR participant IS registered, so `vat_registered = false` forcing
// 'not_applicable' would silently contradict the open enrolment.
function assertSchemeExemptNotCleared(current, updates) {
  const next = updates.vat_filing_frequency
  if (current.vat_filing_frequency === 'exempt' && next !== undefined && next !== 'exempt') {
    abortTransaction(conflict('End the VAT scheme enrolment instead', {
      code: 'filing_frequency_derived_from_scheme',
    }))
  }
}

// Keeps the legacy tenants columns in step during the expand phase.
//
// `applies_kor` is deliberately NOT projected here any more. It is now a
// projection of the scheme enrolment in force TODAY, which is a date-dependent
// fact a field write cannot express: an enrolment can be scheduled to start or
// end in the future. taxSchemeEnrolmentService.syncSchemeProjections owns it, and
// server/jobs/taxSchemeReconciliation.js catches it up on boundary dates.
async function projectToLegacyColumns(client, tenantId, updates) {
  const fields = []
  const values = []
  for (const key of LEGACY_PROJECTED_FIELDS) {
    if (!(key in updates)) continue
    fields.push(`${key} = $${fields.length + 1}`)
    values.push(updates[key])
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
