// VAT scheme enrolment domain logic: which small-business or cross-border regime
// the tenant is in, and between which dates. Route handlers stay thin and
// delegate here.
//
// Two facts this module keeps apart, deliberately:
//
//   * A `national_home` enrolment governs the tenant's DOMESTIC VAT treatment and
//     its filing obligation. There can be at most one in force at a time.
//   * An `eu_sme_destination` enrolment is a per-destination cross-border
//     exemption. It never touches the home filing regime — a Belgian EU SME
//     exemption does not stop Dutch VAT returns.
//
// Nothing here re-renders or re-resolves an already issued document: those carry
// their own snapshot (see vatTreatmentService), which is precisely why enrolment
// history stays freely correctable.
// Audit events follow the house contract: the service returns an
// { action, details } descriptor and the ROUTE emits it via auditLog(req, ...),
// which is where the session and client ip live.
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { acquireAccountingSettingsLock } from '../repositories/accountRepository.js'
import { fetchAccountingProfile, updateAccountingProfile } from '../repositories/accountingProfileRepository.js'
import {
  fetchEnrolment,
  listSchemeEnrolments,
  fetchHomeSchemeEnrolmentOn,
  fetchOverlapping,
  fetchOverlappingHomeScheme,
  insertSchemeEnrolment,
  updateSchemeEnrolment,
  voidSchemeEnrolment,
  deleteSchemeEnrolment,
  hasIssuedDocumentInRange,
} from '../repositories/taxSchemeEnrolmentRepository.js'
import {
  buildEnrolmentInsert,
  buildEnrolmentUpdate,
  validateVoidReason,
} from '../validators/taxSchemeEnrolmentValidators.js'
import { isProfileComplete } from '../validators/accountingProfileValidators.js'
import { getTaxScheme, TAX_SCHEMES } from '../../shared/taxSchemes.js'
import { toUblDate as toDateOnly } from '../../shared/peppol.js'
import { badRequest, conflict, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Enrolment not found')

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Decorates a row with its registry entry so no consumer re-derives the label or
// whether the scheme does anything. `scheme` is null for a code a later pack
// retired — the row stays readable, which is the point of not FK-ing the code.
function present(row) {
  const scheme = getTaxScheme(row.scheme_code)
  return {
    ...row,
    valid_from: toDateOnly(row.valid_from),
    valid_to: toDateOnly(row.valid_to),
    source_confirmation_date: toDateOnly(row.source_confirmation_date),
    scheme_label: scheme?.label ?? row.scheme_code,
    scheme_implemented: Boolean(scheme?.implemented),
    scheme_sales_treatment: scheme?.salesTreatment ?? null,
  }
}

export async function listEnrolments(db, tenantId) {
  const rows = await listSchemeEnrolments(db, tenantId)
  return { enrolments: rows.map(present) }
}

// Rejects a range that touches an existing enrolment of the same scheme, or —
// for a home scheme — any other home scheme. The open cases are also covered by
// partial unique indexes; this catches the closed ones, which no constraint can
// express without the btree_gist extension.
async function assertNoOverlap(client, tenantId, { countryCode, schemeCode, scope, from, to, excludeId = null }) {
  const sameScheme = await fetchOverlapping(client, tenantId, countryCode, schemeCode, from, to, { excludeId })
  if (sameScheme) {
    abortTransaction(conflict('An enrolment for this scheme already covers those dates', {
      code: 'overlapping_enrolment',
      enrolment_id: sameScheme.id,
    }))
  }
  if (scope !== 'national_home') return
  const otherHome = await fetchOverlappingHomeScheme(client, tenantId, from, to, { excludeId })
  if (otherHome) {
    abortTransaction(conflict('Another national scheme already covers those dates', {
      code: 'overlapping_enrolment',
      enrolment_id: otherHome.id,
    }))
  }
}

export async function startEnrolment(db, tenantId, body = {}, actorUserId = null) {
  return withTransaction(async (client) => {
    await acquireAccountingSettingsLock(client, tenantId)

    const profile = await fetchAccountingProfile(client, tenantId)
    if (!profile) abortTransaction(notFound('Accounting profile not found'))

    const built = buildEnrolmentInsert(body, { homeCountry: profile.country_code })
    if (built.error) abortTransaction(badRequest(built.error))

    const { enrolment } = built

    // A small-business-scheme participant holds a VAT number and IS registered —
    // the scheme relieves it of charging and filing, it does not deregister it
    // (spec §9.4). Recording one against a confirmed "not registered" would store
    // a state whose two halves contradict each other, so it is refused at the
    // source rather than left for the completeness rule to flag later.
    if (enrolment.scheme_scope === 'national_home' && profile.vat_registered === false) {
      abortTransaction(conflict('Confirm VAT registration before enrolling in a scheme', {
        code: 'scheme_requires_vat_registration',
      }))
    }
    await assertNoOverlap(client, tenantId, {
      countryCode: enrolment.country_code,
      schemeCode: enrolment.scheme_code,
      scope: enrolment.scheme_scope,
      from: enrolment.valid_from,
      to: enrolment.valid_to,
    })

    const inserted = await insertSchemeEnrolment(client, tenantId, {
      ...enrolment,
      created_by_user_id: actorUserId,
    })

    await syncSchemeProjections(client, tenantId, profile)
    return { enrolment: present(inserted) }
  }, { db })
}

export async function updateEnrolment(db, tenantId, id, body = {}) {
  return withTransaction(async (client) => {
    await acquireAccountingSettingsLock(client, tenantId)

    const current = await fetchEnrolment(client, tenantId, id)
    if (!current) abortTransaction(NOT_FOUND)
    if (current.voided_at) {
      abortTransaction(conflict('A voided enrolment cannot be edited', { code: 'enrolment_voided' }))
    }

    const built = buildEnrolmentUpdate(body, { current })
    if (built.error) abortTransaction(badRequest(built.error))

    await assertNoOverlap(client, tenantId, {
      countryCode: current.country_code,
      schemeCode: current.scheme_code,
      scope: current.scheme_scope,
      from: built.effectiveRange.from,
      to: built.effectiveRange.to,
      excludeId: id,
    })

    const updated = await updateSchemeEnrolment(client, tenantId, id, built.updates)
    if (!updated) abortTransaction(NOT_FOUND)

    const profile = await fetchAccountingProfile(client, tenantId)
    await syncSchemeProjections(client, tenantId, profile)
    return { enrolment: present(updated) }
  }, { db })
}

// Voiding is the DEFAULT removal, matching the corrections-forward rule the
// ledger follows. A confirmed enrolment is the evidence explaining why an issued
// document's snapshot says what it says; deleting it would leave the snapshot
// unexplained even though the snapshot itself survives.
export async function voidEnrolment(db, tenantId, id, body = {}, actorUserId = null) {
  const reason = validateVoidReason(body.reason)
  if (reason.error) return badRequest(reason.error)

  return withTransaction(async (client) => {
    await acquireAccountingSettingsLock(client, tenantId)

    const voided = await voidSchemeEnrolment(client, tenantId, id, {
      reason: reason.value,
      actorUserId,
    })
    if (!voided) abortTransaction(NOT_FOUND)

    const profile = await fetchAccountingProfile(client, tenantId)
    await syncSchemeProjections(client, tenantId, profile)

    return {
      enrolment: present(voided),
      audit: {
        action: 'tax_scheme_enrolment.voided',
        details: { enrolmentId: id, schemeCode: voided.scheme_code, reason: reason.value },
      },
    }
  }, { db })
}

// Hard delete is the narrow "this never really happened" case: a row the
// MIGRATION inferred, that no human has confirmed, and that no issued document
// falls inside. Anything else is voided instead, so the history stays auditable.
// The actor is not stored: the row is going away, and the audit event the route
// emits already carries the session user.
export async function deleteEnrolment(db, tenantId, id) {
  return withTransaction(async (client) => {
    await acquireAccountingSettingsLock(client, tenantId)

    const current = await fetchEnrolment(client, tenantId, id)
    if (!current) abortTransaction(NOT_FOUND)
    if (current.status !== 'legacy_inferred' || current.voided_at) {
      abortTransaction(conflict('A confirmed enrolment is voided, not deleted', {
        code: 'enrolment_confirmed',
      }))
    }

    const referenced = await hasIssuedDocumentInRange(
      client, tenantId, toDateOnly(current.valid_from), toDateOnly(current.valid_to),
    )
    if (referenced) {
      abortTransaction(conflict('Issued documents fall inside this enrolment', {
        code: 'enrolment_referenced',
      }))
    }

    await deleteSchemeEnrolment(client, tenantId, id)

    const profile = await fetchAccountingProfile(client, tenantId)
    await syncSchemeProjections(client, tenantId, profile)

    return {
      audit: {
        action: 'tax_scheme_enrolment.deleted',
        details: { enrolmentId: id, schemeCode: current.scheme_code },
      },
    }
  }, { db })
}

// Recomputes `profiles.vat_filing_frequency` from the HOME enrolment in force on
// `asOf`, in the caller's transaction. 'exempt' is derived from the scheme, not
// asked separately: two controls for one fact could disagree.
//
// STALE BY CONSTRUCTION for an enrolment scheduled to start or end in the future
// — nothing writes it on the boundary date. The date-aware resolver is the
// authority; server/jobs/taxSchemeReconciliation.js catches the field up on a
// tick.
export async function syncSchemeProjections(client, tenantId, profile, { asOf = today() } = {}) {
  if (!profile) return { changed: false }

  const active = await fetchHomeSchemeEnrolmentOn(client, tenantId, profile.country_code, asOf)
  const frequency = deriveFilingFrequency(Boolean(active), profile.vat_filing_frequency)

  // Completeness is derived from the filing frequency, so it is recomputed here
  // too — with the same owner patchAccountingProfile uses. Enrolling is a second
  // way the inputs change, and a rule derived in only one of its two entry
  // points is a rule that drifts.
  const nextStatus = isProfileComplete({ ...profile, vat_filing_frequency: frequency })
    ? 'complete'
    : 'incomplete'
  const frequencyChanged = frequency !== profile.vat_filing_frequency
  const statusChanged = nextStatus !== profile.profile_status
  if (frequencyChanged || statusChanged) {
    await updateAccountingProfile(client, tenantId, {
      vat_filing_frequency: frequency,
      profile_status: nextStatus,
    })
  }

  return {
    changed: frequencyChanged,
    vatFilingFrequency: frequency,
    activeSchemeCode: active?.scheme_code ?? null,
  }
}

// Enrolled → 'exempt'. Leaving the scheme returns the field to unanswered rather
// than guessing a period the tax authority has not assigned yet; a band that was
// never exempt keeps whatever it already stated.
function deriveFilingFrequency(enrolled, current) {
  if (enrolled) return 'exempt'
  return current === 'exempt' ? 'unconfigured' : current
}
