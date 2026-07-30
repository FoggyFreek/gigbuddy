// THE single owner of "what VAT treatment does this document have".
//
// Totals, snapshot capture, the PDF and the UBL all resolve through here. There
// are exactly two answers, and which one applies is the whole design:
//
//   ISSUED document  -> read the snapshot off the row. No profile read, no
//                       enrolment read, no registry call. This is what makes a
//                       re-render of a two-year-old invoice reproduce the
//                       document that was actually sent, even after the tenant
//                       changes scheme, and even after a country pack changes
//                       what a scheme means.
//   DRAFT            -> resolve live, DATE-AWARE, from the accounting profile
//                       and the home enrolment in force at the document's tax
//                       point. An enrolment scheduled to start or end in the
//                       future therefore takes effect on its boundary date with
//                       no job having to run.
//
// The tax point is the supply date when there is one (BT-72, snapshotted from
// the gig at create), else the issue date; a purchase uses its receipt date. The
// two only diverge across a scheme boundary — which is exactly the case worth
// getting right.
import { loadAccountingProfile } from './accountingProfileService.js'
import { fetchHomeSchemeEnrolmentOn } from '../repositories/taxSchemeEnrolmentRepository.js'
import { resolveVatTreatment, TAX_TREATMENT_VERSION } from '../../shared/taxSchemes.js'
import { toUblDate as toDateOnly } from '../../shared/peppol.js'
import { logger } from '../utils/logger.js'

// A purchase is "posted" from approval onwards; an invoice is ISSUED, which is
// narrower than finalized — applyStatusFields stamps finalized_at on draft ->
// void too, and an abandoned draft was never issued.
export function isIssuedInvoiceStatus(status) {
  return status === 'sent' || status === 'paid'
}

export function taxPointDate(invoice) {
  return toDateOnly(invoice.supply_date) ?? toDateOnly(invoice.issue_date)
}

function fromSnapshot(row) {
  return {
    accounting_country: row.accounting_country_snapshot,
    vat_scheme_code: row.vat_scheme_code_snapshot,
    vat_treatment: row.vat_treatment_snapshot,
    chargesOutputVat: row.charges_output_vat_snapshot,
    // Sales-side only; a purchase row carries its own column.
    inputVatRecoverable: row.input_vat_recoverable_snapshot ?? null,
    vat_treatment_version: row.vat_treatment_version,
    source: row.vat_snapshot_source,
  }
}

function hasSnapshot(row) {
  return Boolean(row?.accounting_country_snapshot) && row.vat_treatment_snapshot !== null
}

// Shapes a resolver result the same way whether it came from the registry or a
// stored row, so callers never branch on provenance.
function fromResolved(countryCode, resolved) {
  return {
    accounting_country: countryCode,
    vat_scheme_code: resolved.schemeCode,
    vat_treatment: resolved.salesTreatment,
    chargesOutputVat: resolved.chargesOutputVat,
    inputVatRecoverable: resolved.inputVatRecoverable,
    vat_treatment_version: resolved.version,
    // Not yet persisted; a caller capturing this writes 'issued'.
    source: null,
    // Whether the SCHEME alone suppresses output VAT. computeInvoiceTotals takes
    // reverse charge as a separate input, so it must not get the combined value.
    schemeExempt: resolved.schemeExempt,
  }
}

// Live, date-aware resolution. `reverseCharge` belongs to the document, not the
// regime, so the caller supplies it.
// An enrolment is the only thing that can make a document exempt: no enrolment
// covering the tax point is the ordinary VAT-charging case.
export async function resolveLiveTreatment(executor, tenantId, isoDate, { reverseCharge = false } = {}) {
  const profile = await loadAccountingProfile(executor, tenantId)
  const enrolment = await fetchHomeSchemeEnrolmentOn(executor, tenantId, profile.country_code, isoDate)

  return fromResolved(
    profile.country_code,
    resolveVatTreatment({ version: TAX_TREATMENT_VERSION, homeEnrolment: enrolment, reverseCharge }),
  )
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// The treatment of ONE invoice. Snapshot-first, so an issued invoice is immune to
// every later configuration change.
export async function resolveInvoiceVatTreatment(executor, tenantId, invoice) {
  if (hasSnapshot(invoice)) {
    const snapshot = fromSnapshot(invoice)
    // The scheme's own contribution, recovered for computeInvoiceTotals: reverse
    // charge is already a column on the invoice and stays its own input.
    snapshot.schemeExempt = snapshot.vat_treatment === 'small_business_exempt'
    return snapshot
  }

  // An issued invoice with no snapshot can only be one the previous app container
  // wrote during a deployment. Falling back keeps it renderable; the audit script
  // reports it and --apply fills it in.
  if (isIssuedInvoiceStatus(invoice.status) || invoice.finalized_at) {
    logger.warn('invoice.vat_snapshot_missing', { tenantId, invoiceId: invoice.id })
  }

  return resolveLiveTreatment(executor, tenantId, taxPointDate(invoice), {
    reverseCharge: Boolean(invoice.reverse_charge),
  })
}

// The treatment of ONE purchase. A purchase never carries reverse charge of its
// own here, and — the point worth repeating — no scheme ever changes a purchase's
// amounts. What the scheme decides is whether the supplier's VAT is RECOVERABLE.
export async function resolvePurchaseVatTreatment(executor, tenantId, purchase) {
  if (hasSnapshot(purchase)) return fromSnapshot(purchase)

  if (purchase.status === 'approved' || purchase.status === 'paid') {
    logger.warn('purchase.vat_snapshot_missing', { tenantId, purchaseId: purchase.id })
  }

  return resolveLiveTreatment(executor, tenantId, toDateOnly(purchase.receipt_date))
}

// The columns to persist when a document is issued/approved. Shared by both
// capture paths so the two can never write a different shape.
export function invoiceSnapshotColumns(treatment) {
  return {
    accounting_country_snapshot: treatment.accounting_country,
    vat_scheme_code_snapshot: treatment.vat_scheme_code,
    vat_treatment_snapshot: treatment.vat_treatment,
    charges_output_vat_snapshot: treatment.chargesOutputVat,
    vat_treatment_version: treatment.vat_treatment_version,
    vat_snapshot_source: 'issued',
  }
}

export function purchaseSnapshotColumns(treatment) {
  return {
    accounting_country_snapshot: treatment.accounting_country,
    vat_scheme_code_snapshot: treatment.vat_scheme_code,
    vat_treatment_snapshot: treatment.vat_treatment,
    input_vat_recoverable_snapshot: treatment.inputVatRecoverable,
    vat_treatment_version: treatment.vat_treatment_version,
    vat_snapshot_source: 'issued',
  }
}

// The sales-side answer for a draft or a preview, resolved for a date. Used by
// GET /accounting-profile so the invoice form never has to read a projection
// that goes stale on a scheduled enrolment's boundary date.
export async function resolveCurrentSalesTreatment(executor, tenantId, isoDate = todayIso()) {
  const treatment = await resolveLiveTreatment(executor, tenantId, isoDate)
  return {
    accounting_country: treatment.accounting_country,
    vat_scheme_code: treatment.vat_scheme_code,
    vat_treatment: treatment.vat_treatment,
    scheme_exempt: treatment.schemeExempt,
    input_vat_recoverable: treatment.inputVatRecoverable,
  }
}
