import { useTranslation } from 'react-i18next'

const RESULT_STATUS_KEYS = [
  'imported', 'reconciled_invoice', 'reconciled_purchase', 'reconciled_shopify_payout',
  'reconciled_paypal_payout', 'skipped', 'skipped_currency', 'pending',
  'skipped_already_committed', 'skipped_amount_mismatch', 'skipped_invalid_account',
  'skipped_direction_mismatch', 'skipped_invoice_not_open', 'skipped_invoice_has_link',
  'skipped_bill_not_open', 'skipped_not_found', 'skipped_invalid_supplier', 'skipped_vat_not_allowed',
  'skipped_closed_period', 'skipped_accounting_not_configured',
  'skipped_invoice_paid_via_mollie', 'skipped_mollie_error',
  'skipped_mollie_reconciliation_conflict',
  'skipped_shopify_sync_error', 'skipped_payout_reconciled', 'skipped_payout_incomplete',
  'skipped_payout_mapping_required', 'skipped_currency_mismatch',
] as const

// Maps a line/commit status code to its localized label, falling back to the
// raw code. Shared by the review grid (re-uploaded lines) and the done step.
export function useStatusLabel(): (status: string) => string {
  const { t } = useTranslation('ledger')
  return (status) => {
    const key = (RESULT_STATUS_KEYS as readonly string[]).includes(status)
      ? (status as typeof RESULT_STATUS_KEYS[number]) : null
    return key ? t($ => $.bankImport.lineStatus[key]) : status
  }
}
