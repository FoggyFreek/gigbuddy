// Assembles the UBL/Peppol XML download for an invoice — the structured
// counterpart to the stored PDF. Sibling of invoiceEmailService.js: document
// assembly kept out of the (already large) invoiceService.
//
// Generated on demand rather than stored. The embedded variant reads the PDF
// that invoiceService already finished rendering and stored at `pdf_path`.
import { fetchInvoiceWithGig, fetchLines } from '../repositories/invoiceRepository.js'
import { fetchTenant } from '../repositories/tenantRepository.js'
import { getObject } from './storageService.js'
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
async function readBase64(key) {
  const stream = await getObject(key)
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('base64')
}

export async function buildInvoiceUbl(pool, tenantId, invoiceId, { embedPdf = false } = {}) {
  const invoice = await fetchInvoiceWithGig(pool, tenantId, invoiceId)
  if (!invoice) return NOT_FOUND

  const lines = await fetchLines(pool, invoiceId, tenantId)
  const tenant = await fetchTenant(pool, tenantId)
  const safeNumber = String(invoice.invoice_number || 'concept').replaceAll(/[^a-zA-Z0-9-]/g, '-')

  let embeddedPdf
  if (embedPdf) {
    embeddedPdf = invoice.pdf_path
      ? {
          filename: `factuur-${safeNumber}.pdf`,
          base64: await readBase64(invoice.pdf_path),
        }
      : null
  }

  const content = renderInvoiceUbl({ invoice, lines, tenant, embeddedPdf })
  const warnings = checkPeppolReadiness({ invoice, lines, tenant })

  return { filename: `factuur-${safeNumber}.xml`, content, warnings }
}
