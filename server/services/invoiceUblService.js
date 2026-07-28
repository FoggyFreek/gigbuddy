// Assembles the UBL/Peppol XML download for an invoice — the structured
// counterpart to the stored PDF. Sibling of invoiceEmailService.js: document
// assembly kept out of the (already large) invoiceService.
//
// Generated on demand rather than stored: the XML is derived entirely from rows
// we already hold, so persisting it would only add a second artefact to keep in
// sync with every invoice edit.
import { fetchInvoiceWithGig, fetchLines } from '../repositories/invoiceRepository.js'
import { fetchTenant } from '../repositories/tenantRepository.js'
import { renderInvoiceUbl } from '../utils/renderInvoiceUbl.js'
import { checkPeppolReadiness } from '../../shared/peppolReadiness.js'
import { notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Not found')

// Returns { filename, content, warnings } | { error }.
//
// The file is produced even when `warnings` contains blocking entries: this is a
// download, not a transmission, and refusing would make the feature unusable for
// the many invoices whose customer has no VAT number. The caller surfaces the
// warnings so the user knows a receiver may reject it.
export async function buildInvoiceUbl(pool, tenantId, invoiceId) {
  const invoice = await fetchInvoiceWithGig(pool, tenantId, invoiceId)
  if (!invoice) return NOT_FOUND

  const lines = await fetchLines(pool, invoiceId, tenantId)
  const tenant = await fetchTenant(pool, tenantId)

  const content = renderInvoiceUbl({ invoice, lines, tenant })
  const warnings = checkPeppolReadiness({ invoice, lines, tenant })

  const safeNumber = String(invoice.invoice_number || 'concept').replaceAll(/[^a-zA-Z0-9-]/g, '-')
  return { filename: `factuur-${safeNumber}.xml`, content, warnings }
}
