// Typed wrapper over shared/invoiceReadiness.js — the same art. 226 / art. 196 /
// VIES rules the backend enforces. Used to PREVIEW readiness in the invoice form
// so "Mark as sent" can say what is missing instead of failing with a 422. The
// backend stays authoritative; this is UX only.
import {
  INVOICE_ISSUE_ERROR_CODES as CODES_JS,
  checkInvoiceReadyForIssue as checkJs,
  storedViesConfirmation as storedViesConfirmationJs,
} from '../../shared/invoiceReadiness.js'
import type { InvoiceLine, Tenant } from '../types/entities.ts'

/**
 * Exactly the invoice fields the readiness rules read. Declared here rather than
 * reusing `Invoice` so the form (whose date/text fields are nullable) can be
 * passed straight in.
 */
export interface InvoiceReadinessInput {
  customer_name?: string | null
  customer_address_street?: string | null
  customer_address_city?: string | null
  customer_address_country?: string | null
  customer_tax_id?: string | null
  issue_date?: string | null
  reverse_charge?: boolean
  tax_cents?: number | null
  /** The VAT number a VIES confirmation covers; null when there is none. */
  vies_confirmed_for?: string | null
}

/**
 * The VAT number a stored (server-side) VIES confirmation covers, or null.
 * Takes a loose record so a raw invoice payload can be passed straight in.
 */
export function storedViesConfirmation(row: Readonly<Record<string, unknown>>): string | null {
  return (storedViesConfirmationJs(row) as string | null) ?? null
}

export type InvoiceIssueErrorCode =
  | 'incomplete_supplier_details'
  | 'incomplete_customer_details'
  | 'missing_issue_date'
  | 'invalid_lines'
  | 'missing_registration_info'
  | 'missing_supplier_vat_id'
  | 'customer_tax_id_required_for_reverse_charge'
  | 'reverse_charge_xi_services_unsupported'
  | 'reverse_charge_requires_eu_supplier'
  | 'reverse_charge_requires_eu_customer'
  | 'reverse_charge_requires_cross_border'
  | 'customer_vat_number_country_mismatch'
  | 'invalid_customer_vat_number'
  | 'reverse_charge_vies_check_required'
  | 'reverse_charge_vies_check_stale'

export const INVOICE_ISSUE_ERROR_CODES = CODES_JS as readonly InvoiceIssueErrorCode[]

const CODE_SET = new Set<string>(INVOICE_ISSUE_ERROR_CODES)

/** Narrows an arbitrary server `code` to one this module has a message for. */
export function isInvoiceIssueErrorCode(code: unknown): code is InvoiceIssueErrorCode {
  return typeof code === 'string' && CODE_SET.has(code)
}

/** The reason this invoice cannot be issued yet, or null when it is ready. */
export function checkInvoiceReadyForIssue(
  invoice: InvoiceReadinessInput,
  lines: Pick<InvoiceLine, 'description' | 'quantity'>[],
  tenant: Partial<Tenant> | null,
): InvoiceIssueErrorCode | null {
  if (!tenant) return null // tenant not loaded yet — don't claim a problem
  return checkJs(invoice, lines, tenant) as InvoiceIssueErrorCode | null
}
