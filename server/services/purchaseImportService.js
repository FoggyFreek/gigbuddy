// E-invoice import: turn a supplier's UBL invoice into a draft purchase.
//
// Deliberately NOT the bank importer's two-phase staging. A purchase draft is
// already a review surface — editable, deletable, and posting nothing to the
// ledger until someone approves it — so staging the same data in a second table
// first would duplicate what `status = 'draft'` provides. The document lands as
// a draft, the user checks it in the existing detail editor, and approval stays
// the deliberate human step it is for a hand-entered bill.
//
// Nothing here writes purchase rows itself: it builds the same body POST
// /purchases accepts and hands it to createPurchase, so receipt numbering, line
// validation, totals and tenant scoping have exactly one implementation.
import { decodeUploadedText } from '../utils/decodeText.js'
import { parseUblInvoice, UblParseError } from '../utils/parseUblInvoice.js'
import { mapUblInvoiceToPurchase } from '../utils/ublInvoiceToPurchase.js'
import { indexSuppliers, matchSuppliers } from '../utils/supplierMatch.js'
import { verifyDocumentContent } from '../utils/verifyFileContent.js'
import { findSuppliersForImport } from '../repositories/contactRepository.js'
import { findPurchaseDuplicates } from '../repositories/purchaseRepository.js'
import { fetchTenantVatCountry } from '../repositories/tenantRepository.js'
import { createPurchase, createPurchaseAttachment } from './purchaseService.js'
import { computePurchaseTotals } from '../../shared/purchaseTotals.js'
import { importWarning, sortImportWarnings } from '../../shared/purchaseImportWarnings.js'
import { badRequest } from './serviceErrors.js'
import { logger } from '../utils/logger.js'

// The ledger books a purchase in EUR. Importing another currency would file the
// supplier's figures under the wrong unit, which is worse than refusing.
const LEDGER_CURRENCY = 'EUR'

const PDF_MIME = 'application/pdf'

/**
 * Parses an uploaded UBL invoice and creates the draft purchase it describes.
 *
 * @returns {{ purchaseId: number, warnings: object[] } | { error: object }}
 *   `warnings` are `{ code, severity, …context }`, the same shape the Peppol
 *   readiness check returns, so the frontend renders both the same way.
 */
export async function importPurchaseFromUbl({ db, tenantId, file, actorUserId }) {
  if (!file?.buffer?.length) return badRequest('No file uploaded')

  let doc
  try {
    doc = parseUblInvoice(decodeUploadedText(file.buffer))
  } catch (err) {
    if (err instanceof UblParseError) {
      return { error: { status: 400, body: { error: err.message, code: 'ubl_parse_failed' } } }
    }
    throw err
  }

  if (doc.currency && doc.currency !== LEDGER_CURRENCY) {
    return {
      error: {
        status: 400,
        body: {
          error: `Only ${LEDGER_CURRENCY} invoices can be imported`,
          code: 'unsupported_currency',
          currency: doc.currency,
        },
      },
    }
  }

  const vatCountry = await fetchTenantVatCountry(db, tenantId)
  const { purchase, warnings } = mapUblInvoiceToPurchase(doc, { vatCountry })

  if (!purchase.supplier_name) {
    return { error: { status: 400, body: { error: 'Invoice names no supplier', code: 'missing_supplier_name' } } }
  }

  const supplier = await resolveSupplier(db, tenantId, doc)
  if (supplier) purchase.supplier_contact_id = supplier.id
  else warnings.push(importWarning('supplier_not_matched'))

  const duplicates = await findPurchaseDuplicates(db, tenantId, {
    supplierContactId: purchase.supplier_contact_id,
    supplierName: purchase.supplier_name,
    receiptDate: purchase.receipt_date,
    totalCents: computePurchaseTotals({ lines: purchase.lines }).totalCents,
  })
  if (duplicates.length) {
    warnings.push(importWarning('possible_duplicate', {
      receiptNumbers: duplicates.map((row) => row.receipt_number),
    }))
  }

  // Never `approved`: an imported document has had no human look at it yet, and
  // approving posts the accrual journal.
  const created = await createPurchase(db, tenantId, purchase, actorUserId, { canManageFinance: false })
  if (created.error) return created

  const attached = await attachSourceDocument({
    db, tenantId, purchaseId: created.purchaseId, doc,
  })
  if (attached) warnings.push(attached)

  return { purchaseId: created.purchaseId, warnings: sortImportWarnings(warnings) }
}

// The supplier contact this invoice's seller already is, or null. Matching only:
// creating a contact as a side effect of an upload would put a row in the CRM
// the user never asked for, so an unmatched supplier is reported instead and
// stays free text until they link it.
async function resolveSupplier(db, tenantId, doc) {
  const name = doc.supplier?.name ?? null
  const iban = doc.payeeIban
  const candidates = await findSuppliersForImport(db, tenantId, [iban], [name])
  const matches = matchSuppliers(indexSuppliers(candidates), { iban, name })
  // Several contacts share the identifier — let the user pick rather than guess.
  return matches.length === 1 ? matches[0] : null
}

// Stores the human-readable PDF the supplier embedded in the XML (BT-125), so
// the purchase carries the document a person can actually read.
//
// Returns a warning to append, or null when there was nothing to do. A failure
// here never fails the import: the purchase itself is already correct, and the
// attachment is a convenience.
async function attachSourceDocument({ db, tenantId, purchaseId, doc }) {
  const embedded = doc.attachments.find((a) => a.mimeCode === PDF_MIME) ?? doc.attachments[0]
  if (!embedded) return null

  // The mime code is the sender's claim about their own bytes; check them.
  if (!verifyDocumentContent(embedded.bytes, PDF_MIME)) {
    return importWarning('attachment_skipped')
  }

  const result = await createPurchaseAttachment({
    db,
    tenantId,
    purchaseId,
    file: {
      buffer: embedded.bytes,
      size: embedded.bytes.length,
      mimetype: PDF_MIME,
      originalname: embedded.filename,
    },
  }).catch((err) => {
    logger.error('purchase_import.attachment_failed', { err, tenantId, purchaseId })
    return { error: true }
  })

  return result?.error ? importWarning('attachment_skipped') : null
}
