// Typed mirror of shared/purchaseImportWarnings.js — the codes the e-invoice
// importer raises. Mirrors src/utils/peppolReadiness.ts: the union keeps the
// i18n lookup `t($ => $.importDialog.warnings[code])` provably complete, so a
// code added on the backend without a translation fails the type check.
import {
  PURCHASE_IMPORT_WARNING_CODES as CODES_JS,
  isBlockingImportWarning as isBlockingJs,
} from '../../shared/purchaseImportWarnings.js'

export type PurchaseImportWarningCode =
  | 'vat_self_assessment_required'
  | 'possible_duplicate'
  | 'totals_mismatch'
  | 'line_missing_description'
  | 'lines_synthesized_from_totals'
  | 'buyer_is_not_this_tenant'
  | 'line_vat_rate_defaulted'
  | 'vat_rate_adjusted'
  | 'document_discount_allocated'
  | 'document_charge_allocated'
  | 'prepaid_amount_ignored'
  | 'totals_rounded'
  | 'supplier_not_matched'
  | 'attachment_skipped'
  | 'source_document_not_stored'

export const PURCHASE_IMPORT_WARNING_CODES = CODES_JS as readonly PurchaseImportWarningCode[]

/** True when the warning must be resolved before the draft is approved. */
export function isBlockingImportWarning(code: PurchaseImportWarningCode): boolean {
  return isBlockingJs(code) as boolean
}
