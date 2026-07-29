// What an e-invoice import had to infer, could not reconcile, or wants checked.
//
// One list, in shared/, for the same reason PEPPOL_WARNING_CODES is: the backend
// raises these codes and the frontend renders them, so a code added on one side
// and unknown to the other is the failure mode to design out. The i18n bundles
// are proven complete against this list.
//
// A warning NEVER means the import failed — the draft purchase exists either
// way. 'blocking' means "resolve this before approving", because approving is
// what posts to the ledger.

export const PURCHASE_IMPORT_WARNING_CODES = Object.freeze([
  // Blocking — the draft is not safe to approve as it stands.
  'vat_self_assessment_required',
  'possible_duplicate',
  'totals_mismatch',
  'line_missing_description',
  'lines_synthesized_from_totals',
  'buyer_is_not_this_tenant',
  // Advisory — imported cleanly, but a value was inferred rather than read.
  'line_vat_rate_defaulted',
  'vat_rate_adjusted',
  'document_discount_allocated',
  'document_charge_allocated',
  'prepaid_amount_ignored',
  'totals_rounded',
  'supplier_not_matched',
  'attachment_skipped',
])

const BLOCKING = new Set([
  'vat_self_assessment_required',
  'possible_duplicate',
  'totals_mismatch',
  'line_missing_description',
  'lines_synthesized_from_totals',
  'buyer_is_not_this_tenant',
])

export const isBlockingImportWarning = (code) => BLOCKING.has(code)

/** Builds one warning, with the severity attached from the list above. */
export function importWarning(code, context = null) {
  return { code, severity: BLOCKING.has(code) ? 'blocking' : 'advisory', ...(context ?? {}) }
}

/** Report order: blocking first, then the declared order within each group. */
export function sortImportWarnings(warnings) {
  const rank = (w) => PURCHASE_IMPORT_WARNING_CODES.indexOf(w.code)
  return [...warnings].sort((a, b) => rank(a) - rank(b))
}
