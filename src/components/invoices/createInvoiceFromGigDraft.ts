import { createInvoice } from '../../api/invoices.ts'
import type { InvoiceGigDraft } from '../../api/invoices.ts'
import type { Invoice } from '../../types/entities.ts'
import { buildInvoicePayload, emptyDraft } from './invoiceFormHelpers.ts'
import type { InvoiceFormLine } from './invoiceFormHelpers.ts'

/**
 * Persists an invoice from a draft-from-gig prefill: merges the server's draft
 * over an empty form and POSTs it. Shared by NewInvoiceDialog and the gig
 * detail Terms tab.
 */
export function createInvoiceFromGigDraft(payload: InvoiceGigDraft): Promise<Invoice> {
  const form = {
    ...emptyDraft(),
    ...payload.draft,
    lines: (payload.draft?.lines as InvoiceFormLine[] | undefined) || [],
  }
  return createInvoice(buildInvoicePayload(form))
}
