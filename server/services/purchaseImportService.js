// E-invoice import: turn a supplier's e-invoice into a draft purchase.
//
// Syntax-agnostic: server/utils/eInvoice/ reads UBL, CII and Factur-X/ZUGFeRD
// PDFs into one normalized document, and nothing below this line knows which
// arrived.
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
import { parseEInvoice, EInvoiceParseError } from '../utils/eInvoice/index.js'
import { isPdf } from '../utils/eInvoice/facturx.js'
import { mapEInvoiceToPurchase } from '../utils/eInvoiceToPurchase.js'
import { indexSuppliers, matchSuppliers } from '../utils/supplierMatch.js'
import { verifyDocumentContent } from '../utils/verifyFileContent.js'
import { findSuppliersForImport } from '../repositories/contactRepository.js'
import { findPurchaseDuplicates } from '../repositories/purchaseRepository.js'
import { fetchTenant } from '../repositories/tenantRepository.js'
import { loadAccountingBehavior } from './accountingProfileService.js'
import { normalizeVatNumber } from '../../shared/vatRates.js'
import { createPurchase, createPurchaseAttachment } from './purchaseService.js'
import { computePurchaseTotals } from '../../shared/purchaseTotals.js'
import { importWarning, sortImportWarnings } from '../../shared/purchaseImportWarnings.js'
import { badRequest } from './serviceErrors.js'
import { logger } from '../utils/logger.js'
import {
  normalizeOptionalRegistrationNumber,
  normalizeOptionalVatId,
} from '../utils/businessIdentifiers.js'

// The ledger books a purchase in EUR. Importing another currency would file the
// supplier's figures under the wrong unit, which is worse than refusing.
const LEDGER_CURRENCY = 'EUR'

const PDF_MIME = 'application/pdf'
const XML_MIME = 'application/xml'

/**
 * Parses an uploaded e-invoice and creates the draft purchase it describes.
 *
 * @returns {{ purchaseId: number, warnings: object[] } | { error: object }}
 *   `warnings` are `{ code, severity, …context }`, the same shape the Peppol
 *   readiness check returns, so the frontend renders both the same way.
 */
export async function importPurchaseFromDocument({ db, tenantId, file, actorUserId }) {
  if (!file?.buffer?.length) return badRequest('No file uploaded')

  let doc
  try {
    doc = await parseEInvoice(file.buffer)
  } catch (err) {
    if (err instanceof EInvoiceParseError) {
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

  const tenant = await fetchTenant(db, tenantId)
  const { accountingCountry } = await loadAccountingBehavior(db, tenantId)
  const { purchase, warnings } = mapEInvoiceToPurchase(doc, { vatCountry: accountingCountry })

  if (!purchase.supplier_name) {
    return { error: { status: 400, body: { error: 'Invoice names no supplier', code: 'missing_supplier_name' } } }
  }

  if (addressedElsewhere(doc.customer, tenant)) warnings.push(importWarning('buyer_is_not_this_tenant'))

  const supplier = await resolveSupplier(db, tenantId, doc)
  if (supplier) purchase.supplier_contact_id = supplier.id
  else warnings.push(importWarning('supplier_not_matched'))

  const duplicates = await findPurchaseDuplicates(db, tenantId, {
    supplierContactId: purchase.supplier_contact_id,
    supplierName: purchase.supplier_name,
    supplierInvoiceNumber: purchase.supplier_invoice_number,
    receiptDate: purchase.receipt_date,
    totalCents: computePurchaseTotals({ lines: purchase.lines }).totalCents,
  })
  const receiptsOf = (kind) => duplicates
    .filter((row) => row.match_kind === kind)
    .map((row) => row.receipt_number)

  // Same supplier, same invoice number: an identity, not a resemblance. Refused
  // outright — and the unique index refuses it too, which is what closes the gap
  // between this lookup and the insert when two imports race.
  const sameInvoice = receiptsOf('invoice_number')
  if (sameInvoice.length) {
    return {
      error: {
        status: 409,
        body: {
          error: 'This invoice has already been recorded',
          code: 'supplier_invoice_number_taken',
          receipt_numbers: sameInvoice,
        },
      },
    }
  }

  // Same supplier, date and total as a bill entered by hand (which carries no
  // invoice number to compare). Two genuine purchases can look like this, so
  // this one only warns.
  const looksAlike = receiptsOf('document_facts')
  if (looksAlike.length) {
    warnings.push(importWarning('possible_duplicate', { receiptNumbers: looksAlike }))
  }

  // Never `approved`: an imported document has had no human look at it yet, and
  // approving posts the accrual journal.
  const created = await createPurchase(db, tenantId, purchase, actorUserId, {
    canManageFinance: false,
    supplierImportData: buildSupplierImportData(doc),
  })
  if (created.error) return created

  const target = { db, tenantId, purchaseId: created.purchaseId }
  // The source first: it is the record. The rendering is the nicety.
  for (const warning of [
    await storeSourceDocument({ ...target, file }),
    await attachEmbeddedRendering({ ...target, doc, file }),
  ]) {
    if (warning) warnings.push(warning)
  }

  return { purchaseId: created.purchaseId, warnings: sortImportWarnings(warnings) }
}

function buildSupplierImportData(doc) {
  return {
    name: doc.supplier?.name ?? null,
    email: doc.supplier?.email ?? null,
    iban: doc.payeeIban ?? null,
    kvk_number: normalizeOptionalRegistrationNumber(doc.supplier?.registrationId),
    tax_id: normalizeOptionalVatId(doc.supplier?.vatId),
  }
}

// True when the invoice names a buyer that is demonstrably not this tenant.
//
// Reported, never enforced, and only on a POSITIVE contradiction: most tenants
// have no VAT or registration number on file, and a strict match would reject
// the legitimate invoices of everyone who has not filled in their profile. So
// silence means "nothing to compare", not "verified".
function addressedElsewhere(customer, tenant) {
  if (!customer || !tenant) return false
  const disagrees = (a, b) => Boolean(a) && Boolean(b) && a !== b
  const vatMatch = disagrees(
    normalizeVatNumber(customer.vatId),
    normalizeVatNumber(tenant.tax_id),
  )
  const registrationMatch = disagrees(
    String(customer.registrationId ?? '').trim(),
    String(tenant.kvk_number ?? '').trim(),
  )
  return vatMatch || registrationMatch
}

// The supplier contact this invoice's seller already is, or null. Matching only:
// creating a contact as a side effect of an upload would put a row in the CRM
// the user never asked for, so an unmatched supplier is reported instead and
// stays free text until they link it.
async function resolveSupplier(db, tenantId, doc) {
  const name = doc.supplier?.name ?? null
  const iban = doc.payeeIban
  const taxId = normalizeVatNumber(doc.supplier?.vatId)
  const registrationId = String(doc.supplier?.registrationId ?? '').trim()
  const candidates = await findSuppliersForImport(db, tenantId, [iban], [name], {
    taxIds: [taxId],
    registrationIds: [registrationId],
  })
  const matches = matchSuppliers(indexSuppliers(candidates), {
    iban,
    name,
    taxId,
    registrationId,
  })
  // Several contacts share the identifier — let the user pick rather than guess.
  return matches.length === 1 ? matches[0] : null
}

// Stores the file the purchase was parsed FROM, exactly as it arrived.
//
// This is accounting evidence, not a convenience copy. The structured document
// has to be retained intact — for a hybrid PDF the embedded XML is the
// authoritative half when the two disagree, and an XRechnung has no PDF at all,
// so keeping only a rendered copy would keep the wrong thing (or nothing).
// Stored under kind 'source_e_invoice', which the delete route refuses.
async function storeSourceDocument({ db, tenantId, purchaseId, file }) {
  const result = await createPurchaseAttachment({
    db,
    tenantId,
    purchaseId,
    kind: 'source_e_invoice',
    file: {
      buffer: file.buffer,
      size: file.buffer.length,
      mimetype: isPdf(file.buffer) ? PDF_MIME : XML_MIME,
      originalname: file.originalname || `invoice${isPdf(file.buffer) ? '.pdf' : '.xml'}`,
    },
  }).catch((err) => {
    logger.error('purchase_import.source_document_failed', { err, tenantId, purchaseId })
    return { error: true }
  })
  return result?.error ? importWarning('source_document_not_stored') : null
}

// The human-readable PDF a UBL/CII sender embedded in the XML (BT-125), stored
// alongside the source so the purchase shows something a person can read.
// Skipped for a PDF upload — that file is already stored as the source.
//
// Returns a warning to append, or null when there was nothing to do. A failure
// here never fails the import: the purchase itself is already correct.
async function attachEmbeddedRendering({ db, tenantId, purchaseId, doc, file }) {
  if (isPdf(file?.buffer)) return null
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
