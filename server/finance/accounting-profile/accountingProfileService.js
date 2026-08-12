// Accounting-profile domain logic: the tenant's accounting REGIME (country,
// legal form, entity size, bases, financial-year start, base currency, VAT
// registration status). Route handlers stay thin and delegate here.
//
// Not to be confused with profileService.js, which is the *band* profile
// (name, bio, images, seller identity for invoices).
//
// This is the record every later compliance capability reads its jurisdiction
// facts from — loadAccountingProfile() is that read primitive.
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { acquireAccountingSettingsLock } from '../accounts/accountRepository.js'
import { updateTenantFields } from '../../people/workspaces/tenantRepository.js'
import {
  fetchAccountingProfile,
  insertAccountingProfile,
  updateAccountingProfile,
  markProfileReviewed as markProfileReviewedRow,
  countFinancialDocuments,
  resetProfileCountry,
  voidCountryDependentEnrolments,
  resetProductVatRates,
} from './accountingProfileRepository.js'
import {
  buildAccountingProfileUpdate,
  applyDerivedFields,
  applyVatDependencyRules,
  isProfileComplete,
  profilePresentationState,
} from './accountingProfileValidators.js'
import { resolveCurrentSalesTreatment } from '../vat/vatTreatmentService.js'
import { defaultBaseCurrency, bookkeepingCurrency } from '../../../shared/accountingProfileCodes.js'
import {
  getStandardVatRate,
  isValidVatId,
  normalizeVatCountry,
  normalizeVatNumber,
} from '../../../shared/vatRates.js'
import {
  isValidRegistrationNumber,
  normalizeRegistrationNumber,
  registrationUsesOffice,
} from '../../../shared/businessRegistry.js'
import { lockTenantRow } from '../../people/workspaces/tenantRepository.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'

// A profile is never derived — there is nothing truthful to fall back on — so a
// missing row is an explicit fault. server/index.js turns a 4xx `status` into
// { error, code }, so this reaches the client as 409 from every route. Repair
// with `backfillAccountingProfiles.js --apply --tenant=<id> --country=<cc>`.
export class AccountingProfileMissingError extends Error {
  constructor(tenantId) {
    super('This band has no accounting profile yet')
    this.name = 'AccountingProfileMissingError'
    this.code = 'accounting_profile_missing'
    this.status = 409
    this.tenantId = tenantId
  }
}

// Adds the derived presentation state so no consumer re-implements the
// completeness/provenance combination.
function present(profile) {
  return {
    ...profile,
    default_vat_rate: Number(profile.default_vat_rate),
    presentation_state: profilePresentationState(profile),
  }
}

// Creates the profile for a brand-new tenant. Runs inside the caller's tenant
// creation transaction: if this throws, the tenant itself rolls back.
//
// `legalForm` is supplied only where creation already knows it — a personal
// workspace is a sole trader by construction. A band's is left null for its
// admin to state.
export async function createAccountingProfileForTenant(client, tenantId, countryCode, { legalForm = null } = {}) {
  const inserted = await insertAccountingProfile(client, tenantId, {
    country_code: countryCode,
    base_currency: defaultBaseCurrency(countryCode),
    default_vat_rate: getStandardVatRate(countryCode),
    legal_form: legalForm,
    profile_source: 'tenant_creation',
    profile_status: 'incomplete',
  })
  return inserted ?? fetchAccountingProfile(client, tenantId)
}

export async function getAccountingProfile(db, tenantId) {
  const profile = await loadAccountingProfile(db, tenantId)

  // The sales treatment in force TODAY, resolved from the scheme enrolment. The
  // invoice form previews VAT with it, so a scheme scheduled to start or end
  // shows up on its boundary date instead of whenever something last wrote a
  // projection.
  const currentSalesTreatment = await resolveCurrentSalesTreatment(db, tenantId)
  return { profile: { ...present(profile), current_sales_treatment: currentSalesTreatment } }
}

// The read primitive for every downstream consumer of the accounting regime.
// Throws rather than returning null: it is called deep inside money-moving
// transactions, where a null would silently post against a guessed jurisdiction.
export async function loadAccountingProfile(executor, tenantId) {
  const existing = await fetchAccountingProfile(executor, tenantId)
  if (!existing) throw new AccountingProfileMissingError(tenantId)
  return existing
}

export async function loadAccountingBehavior(executor, tenantId) {
  const profile = await loadAccountingProfile(executor, tenantId)
  return {
    accountingCountry: profile.country_code,
    // Behavioral vs factual: the books are kept in `currency`, the profile
    // records `baseCurrency`. They differ only where multi-currency is not live.
    currency: bookkeepingCurrency(profile.base_currency),
    baseCurrency: profile.base_currency,
    defaultVatRate: Number(profile.default_vat_rate),
    fiscalYearStart: {
      month: Number(profile.financial_year_start_month),
      day: Number(profile.financial_year_start_day),
    },
  }
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

function retainedIdentifier(value, supplied, normalize, valid, conflictCode) {
  if (supplied) {
    if (value === null) return { value: null }
    const normalized = normalize(value)
    if (!valid(normalized)) return { error: badRequest(`Invalid identifier`, { code: conflictCode }) }
    return { value: normalized }
  }
  if (value === null || value === '') return { value }
  if (!valid(value)) return { error: conflict('Stored identifier is incompatible with target country', { code: conflictCode }) }
  return { value }
}

export async function changeAccountingCountry(db, tenantId, body = {}, userId = null) {
  const countryCode = normalizeVatCountry(body.country_code)
  if (!countryCode) return badRequest('invalid_country_code')

  return withTransaction(async (client) => {
    await acquireAccountingSettingsLock(client, tenantId)
    const [current, tenant] = await Promise.all([
      fetchAccountingProfile(client, tenantId),
      lockTenantRow(client, tenantId),
    ])
    if (!current || !tenant) abortTransaction(notFound('Accounting profile not found'))

    const counts = await countFinancialDocuments(client, tenantId)
    const totalDocuments = Object.values(counts).reduce((sum, value) => sum + Number(value), 0)
    if (totalDocuments > 0) {
      abortTransaction(conflict('Accounting country cannot change after financial documents exist', {
        code: 'accounting_country_has_financial_documents',
      }))
    }

    const taxId = retainedIdentifier(
      Object.hasOwn(body, 'tax_id') ? body.tax_id : tenant.tax_id,
      Object.hasOwn(body, 'tax_id'),
      normalizeVatNumber,
      (value) => value === '' || isValidVatId(countryCode, value),
      'tax_id_incompatible_vat_country',
    )
    if (taxId.error) abortTransaction(taxId.error)

    const kvk = retainedIdentifier(
      Object.hasOwn(body, 'kvk_number') ? body.kvk_number : tenant.kvk_number,
      Object.hasOwn(body, 'kvk_number'),
      normalizeRegistrationNumber,
      (value) => isValidRegistrationNumber(countryCode, value),
      'kvk_incompatible_vat_country',
    )
    if (kvk.error) abortTransaction(kvk.error)

    const officeSupplied = Object.hasOwn(body, 'registration_office')
    const registrationOffice = officeSupplied && registrationUsesOffice(countryCode)
      ? (body.registration_office === null ? null : String(body.registration_office).trim() || null)
      : null
    const baseCurrency = defaultBaseCurrency(countryCode)
    const defaultVatRate = getStandardVatRate(countryCode)

    const updated = await resetProfileCountry(client, tenantId, {
      countryCode,
      baseCurrency,
      defaultVatRate,
    })
    // Only the seller IDENTITY still lives on `tenants`; the regime itself moved
    // to the profile row, which resetProfileCountry has just rewritten.
    await updateTenantFields(client, tenantId, [
      'tax_id = $1',
      'kvk_number = $2',
      'registration_office = $3',
    ], [taxId.value, kvk.value, registrationOffice])
    const enrolmentsVoided = await voidCountryDependentEnrolments(client, tenantId, userId)
    const productsReset = await resetProductVatRates(client, tenantId, defaultVatRate)

    return {
      profile: {
        ...present(updated),
        current_sales_treatment: null,
      },
      audit: {
        action: 'accounting_profile.country_changed',
        details: {
          oldCountry: current.country_code,
          newCountry: countryCode,
          affectedCount: enrolmentsVoided + productsReset,
        },
      },
    }
  }, { db })
}
