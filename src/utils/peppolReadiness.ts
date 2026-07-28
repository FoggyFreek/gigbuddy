// Typed wrapper over shared/peppolReadiness.js — the same Peppol BIS Billing 3.0
// rules the backend applies when rendering the UBL file. Used to warn in the
// invoice detail view BEFORE the user downloads, so they learn a receiver would
// bounce the document rather than finding out from a rejection email.
//
// Nothing here blocks the download; 'blocking' means "a Peppol access point will
// reject this", not "we refuse to produce it".
import {
  PEPPOL_WARNING_CODES as CODES_JS,
  checkPeppolReadiness as checkJs,
  isPeppolReady as isReadyJs,
} from '../../shared/peppolReadiness.js'
import type { Invoice, InvoiceLine, Tenant } from '../types/entities.ts'

export type PeppolWarningCode =
  | 'missing_seller_endpoint'
  | 'missing_buyer_endpoint'
  | 'unknown_seller_country'
  | 'unknown_buyer_country'
  | 'missing_seller_postal_code'
  | 'missing_buyer_postal_code'
  | 'missing_payment_account'
  | 'de_domestic_contact_required'
  | 'line_missing_name'
  | 'vat_rounding_drift'
  | 'endpoint_inferred'
  | 'missing_buyer_vat_id'
  | 'buyer_reference_defaulted'

export interface PeppolWarning {
  code: PeppolWarningCode
  severity: 'blocking' | 'advisory'
}

export const PEPPOL_WARNING_CODES = CODES_JS as readonly PeppolWarningCode[]

/**
 * What would stop this invoice's UBL rendering passing Peppol validation.
 * Blocking entries come first. Pass the PERSISTED invoice, not form state — the
 * download route renders what is in the database.
 */
export function checkPeppolReadiness(
  invoice: Invoice | null,
  lines: Pick<InvoiceLine, 'description' | 'quantity' | 'unit_price_cents' | 'tax_percentage'>[],
  tenant: Partial<Tenant> | null,
): PeppolWarning[] {
  if (!invoice || !tenant) return [] // not loaded yet — don't claim a problem
  return checkJs({ invoice, lines, tenant }) as PeppolWarning[]
}

/** True when nothing would make a Peppol access point reject the document. */
export function isPeppolReady(warnings: PeppolWarning[]): boolean {
  return isReadyJs(warnings) as boolean
}
