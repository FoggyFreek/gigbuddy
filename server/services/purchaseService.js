// Purchase domain logic. Route handlers stay thin and delegate here.
//
// Functions return a discriminated result so the HTTP layer can map outcomes
// to status codes without knowing the rules:
//   { error: { status, body } }   — caller should respond with that status/body
//   anything else                 — success payload (see each function)
import { computePurchaseTotals, computePurchaseLineTotals } from '../../shared/purchaseTotals.js'
import {
  fetchPurchase,
  fetchPurchaseLines,
  nextPurchaseNumber,
  insertPurchaseLines,
  replacePurchaseLines,
  validateContactIdForTenant,
  fetchValidPurchaseLineCodes,
  fetchValidProductIds,
  validateBandMemberForTenant,
  listPurchases as listPurchaseRows,
  listPurchasePeriods,
  fetchPurchaseAttachments,
  getPurchaseStatus,
  deletePurchase as deletePurchaseRow,
  deleteAttachmentReturningKey,
} from '../repositories/purchaseRepository.js'
import { buildPeriodWhere } from '../utils/periodQuery.js'
import {
  CONTENT_FIELDS_SET,
  FINALIZED_LOCKED_FIELDS_SET,
  SIMPLE_PATCH_FIELDS,
  STATUS_VALUES,
  normalizeLines,
  parseReceiptNumber,
} from '../validators/purchaseValidators.js'
import {
  ledgerErrorResult,
  loadAccountingSettings,
  postBillAccrued,
  postBillPaid,
} from './ledgerService.js'
import { randomUUID } from 'node:crypto'
import { purchaseAttachmentKey, uploadObject, removeObject, safeRemove } from './storageService.js'
import { verifyDocumentContent } from '../utils/verifyFileContent.js'
import { validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'

const ATTACHMENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

// Receipt/attachment upload. Allowed at any purchase status. Images take the
// share-photo security path (magic bytes + sharp re-encode, which strips
// EXIF/metadata); PDFs are magic-byte verified and stored as-is.
export async function createPurchaseAttachment({ db, tenantId, purchaseId, file }) {
  const { rows } = await db.query(
    'SELECT id FROM purchases WHERE id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  if (!rows.length) return { error: { status: 404, body: { error: 'Not found' } } }

  let buffer = file.buffer
  let size = file.size
  let ext
  if (ATTACHMENT_IMAGE_TYPES.has(file.mimetype)) {
    let image
    try {
      image = await validateAndReencodeImage(file.buffer, file.mimetype)
    } catch (err) {
      if (err.status === 400) return { error: { status: 400, body: { error: err.message } } }
      throw err
    }
    buffer = image.buffer
    size = image.size
    ext = extensionForImageMime(image.mimetype)
  } else {
    if (!verifyDocumentContent(file.buffer, file.mimetype)) {
      return { error: { status: 400, body: { error: 'File content does not match declared type' } } }
    }
    ext = '.pdf'
  }

  const objectKey = purchaseAttachmentKey(tenantId, randomUUID(), ext)
  await uploadObject(objectKey, buffer, size, file.mimetype)

  try {
    const { rows: inserted } = await db.query(
      `INSERT INTO purchase_attachments (purchase_id, tenant_id, object_key, original_filename, content_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, object_key, original_filename, content_type, file_size, uploaded_at`,
      [purchaseId, tenantId, objectKey, file.originalname, file.mimetype, size],
    )
    return { attachment: inserted[0] }
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }
}

// Validates any explicit per-line account codes against the tenant chart: each
// must exist, be active, and be an expense/COGS account or a capitalizable asset
// account. Lines without a code fall back to the tenant default expense account
// at posting time.
async function validateLineAccounts(executor, tenantId, lines) {
  const codes = lines.map((l) => l.account_code).filter(Boolean)
  if (!codes.length) return null
  const valid = await fetchValidPurchaseLineCodes(executor, tenantId, codes)
  const invalid = codes.find((c) => !valid.has(c))
  if (invalid) {
    return { error: { status: 400, body: { error: 'Invalid account_code', code: 'invalid_account_code', account_code: invalid } } }
  }
  return null
}

// Validates per-line product references: each must be an existing, non-archived
// product of the tenant, and carry a positive quantity (normalizeLines already
// nulls quantity when product_id is absent).
async function validateLineProducts(executor, tenantId, lines) {
  const productLines = lines.filter((l) => l.product_id)
  if (!productLines.length) return null
  const missingQty = productLines.find((l) => !l.quantity)
  if (missingQty) {
    return { error: { status: 400, body: { error: 'quantity is required on product lines', code: 'product_quantity_required' } } }
  }
  const valid = await fetchValidProductIds(executor, tenantId, productLines.map((l) => l.product_id))
  const invalid = productLines.find((l) => !valid.has(l.product_id))
  if (invalid) {
    return { error: { status: 400, body: { error: 'Invalid product_id', code: 'invalid_product_id', product_id: invalid.product_id } } }
  }
  return null
}

// Adds each product line's quantity to stock and re-averages the product's
// unit cost (moving average: existing stock value + this purchase's net,
// divided by the new quantity). Runs in the same transaction as the accrual
// journal so stock, cost and ledger can never diverge; the row lock serializes
// against concurrent sales of the same product.
async function applyPurchaseStockIn(client, tenantId, lines) {
  for (const line of lines) {
    if (!line.product_id) continue
    const { netCents } = computePurchaseLineTotals(line)
    const { rows } = await client.query(
      'SELECT quantity_on_hand, unit_cost_cents FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [line.product_id, tenantId],
    )
    const product = rows[0]
    if (!product) continue // validated up front; the composite FK is the backstop
    const newQty = product.quantity_on_hand + line.quantity
    const newCost = Math.round(
      (product.quantity_on_hand * product.unit_cost_cents + netCents) / newQty,
    )
    await client.query(
      `UPDATE products SET quantity_on_hand = $1, unit_cost_cents = $2, updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4`,
      [newQty, newCost, line.product_id, tenantId],
    )
  }
}

const FINALIZED_ERROR ={ status: 409, body: { error: 'Purchase is finalized', code: 'purchase_finalized' } }
const RECEIPT_TAKEN_ERROR = { status: 409, body: { error: 'Receipt number already in use', code: 'receipt_number_taken' } }
const USE_PAYMENT_ENDPOINT_ERROR = { status: 409, body: { error: 'Use the payment endpoint to mark a purchase paid', code: 'use_payment_endpoint' } }

function isUniqueViolation(err) {
  return err?.code === '23505'
}

function isValidIsoDate(value) {
  if (typeof value !== 'string') return false
  const ts = Date.parse(value)
  return !Number.isNaN(ts)
}

function buildApprovalLineValidationError(lines, { requireAccount = false } = {}) {
  const fields = []
  for (const [idx, line] of lines.entries()) {
    if (!String(line.description || '').trim()) {
      fields.push({ line: idx, field: 'description', message: 'Enter a description' })
    }
    if (requireAccount && !line.account_code) {
      fields.push({ line: idx, field: 'account_code', message: 'Choose an expense account' })
    }
    if (Number(line.amount_incl_cents) <= 0) {
      fields.push({ line: idx, field: 'amount_incl_cents', message: 'Enter an amount greater than zero' })
    }
  }
  if (!fields.length) return null
  return {
    error: {
      status: 400,
      body: {
        error: 'Complete the highlighted purchase line fields before approving.',
        code: 'purchase_line_validation',
        fields,
      },
    },
  }
}

async function validateApprovalLines(executor, tenantId, lines) {
  const settings = await loadAccountingSettings(executor, tenantId)
  return buildApprovalLineValidationError(lines, {
    requireAccount: !settings?.default_expense_account_code,
  })
}

// ---------- create ----------

export async function createPurchase(pool, tenantId, body, actorUserId = null) {
  const supplierName = String(body.supplier_name ?? '').trim()
  if (!supplierName) return { error: { status: 400, body: { error: 'supplier_name is required' } } }

  let supplierContactId = null
  if (body.supplier_contact_id != null) {
    supplierContactId = await validateContactIdForTenant(pool, body.supplier_contact_id, tenantId)
    if (supplierContactId === null) return { error: { status: 400, body: { error: 'Invalid supplier_contact_id' } } }
  }

  const lines = normalizeLines(body.lines)
  if (!lines.length) return { error: { status: 400, body: { error: 'At least one line is required' } } }

  const accountErr = await validateLineAccounts(pool, tenantId, lines)
  if (accountErr) return accountErr

  const productErr = await validateLineProducts(pool, tenantId, lines)
  if (productErr) return productErr

  const receiptDate =body.receipt_date || new Date().toISOString().slice(0, 10)
  const dueDate = body.due_date || null
  const currency = String(body.currency || 'EUR').trim() || 'EUR'

  const statusResult = resolveCreateStatus(body)
  if (statusResult.error) return statusResult
  const { status } = statusResult

  const totals = computePurchaseTotals({ lines })

  if (status === 'approved') {
    const approvalErr = await validateApprovalLines(pool, tenantId, lines)
    if (approvalErr) return approvalErr
  }

  const client = await pool.connect()
  let purchaseId
  try {
    await client.query('BEGIN')
    const receiptNumber = await nextPurchaseNumber(client, tenantId)
    const { text, values } = buildCreatePurchaseInsert({
      status, tenantId, receiptNumber, supplierName, supplierContactId,
      receiptDate, dueDate, currency, memo: body.memo || null, totals, actorUserId,
    })
    const { rows } = await client.query(text, values)
    purchaseId = rows[0].id
    await insertPurchaseLines(client, purchaseId, tenantId, lines)

    // Approving a bill accrues the expense + payable. Draft bills post nothing.
    if (status === 'approved') {
      const purchaseRow = buildAccruedPurchaseRow({
        purchaseId, receiptNumber, supplierName, supplierContactId,
        receiptDate, totals,
      })
      await postBillAccrued(client, tenantId, purchaseRow, lines, { actorUserId })
      await applyPurchaseStockIn(client, tenantId, lines)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    throw err
  } finally {
    client.release()
  }

  return { purchaseId }
}

function resolveCreateStatus(body) {
  // Only draft/approved may be set on create; paying goes through the payment endpoint.
  let status = 'draft'
  if (body.status !== undefined) {
    if (body.status !== 'draft' && body.status !== 'approved') {
      return { error: { status: 400, body: { error: 'Invalid status' } } }
    }
    status = body.status
  }
  return { status }
}

function buildCreatePurchaseInsert({
  status, tenantId, receiptNumber, supplierName, supplierContactId,
  receiptDate, dueDate, currency, memo, totals, actorUserId,
}) {
  const text = `INSERT INTO purchases (
       tenant_id, receipt_number, supplier_name, supplier_contact_id,
       receipt_date, due_date, currency, memo,
       subtotal_cents, tax_cents, total_cents,
       status, finalized_at,
       created_by_user_id, approved_by_user_id
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9, $10, $11,
       $12, ${status === 'approved' ? 'NOW()' : 'NULL'},
       $13, ${status === 'approved' ? '$13' : 'NULL'}
     ) RETURNING id`
  const values = [
    tenantId, receiptNumber, supplierName, supplierContactId,
    receiptDate, dueDate, currency, memo,
    totals.subtotalCents, totals.taxCents, totals.totalCents,
    status, actorUserId,
  ]
  return { text, values }
}

function buildAccruedPurchaseRow({ purchaseId, receiptNumber, supplierName, supplierContactId, receiptDate, totals }) {
  return {
    id: purchaseId,
    receipt_number: receiptNumber,
    supplier_name: supplierName,
    supplier_contact_id: supplierContactId,
    receipt_date: receiptDate,
    tax_cents: totals.taxCents,
    total_cents: totals.totalCents,
  }
}

// ---------- patch ----------

function buildSimpleSet(body, supplierContactIdOverride) {
  const assignments = []
  let idx = 1
  for (const key of SIMPLE_PATCH_FIELDS) {
    if (!(key in body)) continue
    let value = body[key]
    if (key === 'supplier_contact_id') value = supplierContactIdOverride
    else if (key === 'supplier_name') value = String(value ?? '').trim()
    assignments.push({ col: key, value, idx: idx++ })
  }
  // memo is editable even after finalization, so it is not in CONTENT_FIELDS;
  // patch it through explicitly when present.
  if ('memo' in body) assignments.push({ col: 'memo', value: body.memo || null, idx: idx++ })
  return { assignments, nextIdx: idx }
}

export async function applyPurchasePatch(pool, tenantId, id, body, actorUserId = null) {
  const existing = await fetchPurchase(pool, tenantId, id)
  if (!existing) return { error: { status: 404, body: { error: 'Not found' } } }

  const preflightErr = await runPatchPreflightValidations(pool, tenantId, id, existing, body)
  if (preflightErr) return preflightErr

  const supplierResult = await resolvePatchSupplierContactId(pool, tenantId, body)
  if (supplierResult.error) return supplierResult
  const { supplierContactId } = supplierResult

  const contentChanged = Object.keys(body).some((k) => CONTENT_FIELDS_SET.has(k))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if ('lines' in body) {
      const lines = normalizeLines(body.lines)
      if (!lines.length) {
        await client.query('ROLLBACK')
        return { error: { status: 400, body: { error: 'At least one line is required' } } }
      }
      await replacePurchaseLines(client, id, tenantId, lines)
    }

    const { assignments, nextIdx } = buildSimpleSet(body, supplierContactId)
    const setClauses = assignments.map((a) => `${a.col} = $${a.idx}`)
    const values = assignments.map((a) => a.value)
    let idx = nextIdx

    if (contentChanged) {
      idx = await appendTotalsSetClauses(client, id, tenantId, { setClauses, values, idx })
    }

    if (body.status !== undefined) {
      idx = appendStatusSetClauses({ setClauses, values, idx }, existing, body, actorUserId)
    }

    if (!setClauses.length) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'No valid fields to update' } } }
    }

    setClauses.push('updated_at = NOW()')
    const sql = `UPDATE purchases SET ${setClauses.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1}`
    values.push(id, tenantId)
    await client.query(sql, values)

    // Transitioning a draft to approved accrues the expense + payable.
    if (body.status === 'approved' && existing.status !== 'approved') {
      const purchaseRow = await fetchPurchase(client, tenantId, id)
      const currentLines = await fetchPurchaseLines(client, id, tenantId)
      await postBillAccrued(client, tenantId, purchaseRow, currentLines, { actorUserId })
      await applyPurchaseStockIn(client, tenantId, currentLines)
    }

    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return mapPatchError(err)
  } finally {
    client.release()
  }
}

function validateStatusTransition(existing, body) {
  if (body.status === undefined) return null
  if (!STATUS_VALUES.has(body.status)) return { error: { status: 400, body: { error: 'Invalid status' } } }
  if (body.status === 'paid') return { error: USE_PAYMENT_ENDPOINT_ERROR }
  // Forward-only: once approved the accrual journal is posted and may never be
  // left dangling by a regression to draft; paid never changes via PATCH.
  if (body.status !== existing.status
      && !(existing.status === 'draft' && body.status === 'approved')) {
    return {
      error: {
        status: 409,
        body: {
          error: `Cannot change purchase status from ${existing.status} to ${body.status}`,
          code: 'invalid_status_transition',
          from: existing.status,
          to: body.status,
        },
      },
    }
  }
  return null
}

async function resolvePatchSupplierContactId(pool, tenantId, body) {
  if (!('supplier_contact_id' in body)) return { supplierContactId: undefined }
  if (body.supplier_contact_id == null) return { supplierContactId: null }
  const supplierContactId = await validateContactIdForTenant(pool, body.supplier_contact_id, tenantId)
  if (supplierContactId === null) return { error: { status: 400, body: { error: 'Invalid supplier_contact_id' } } }
  return { supplierContactId }
}

// Validates the line accounts and products when `lines` is being patched.
// Returns an error result or null.
async function validatePatchedLines(pool, tenantId, body) {
  if (!('lines' in body)) return null
  const normalized = normalizeLines(body.lines)
  const accountErr = await validateLineAccounts(pool, tenantId, normalized)
  if (accountErr) return accountErr
  return validateLineProducts(pool, tenantId, normalized)
}

async function runPatchPreflightValidations(pool, tenantId, id, existing, body) {
  const statusErr = validateStatusTransition(existing, body)
  if (statusErr) return statusErr

  const requestedLockedFields = Object.keys(body).filter((k) => FINALIZED_LOCKED_FIELDS_SET.has(k))
  if (existing.finalized_at !== null && requestedLockedFields.length > 0) {
    return { error: FINALIZED_ERROR }
  }

  if ('receipt_number' in body && parseReceiptNumber(body.receipt_number) === null) {
    return { error: { status: 400, body: { error: 'Invalid receipt_number' } } }
  }

  const lineErr = await validatePatchedLines(pool, tenantId, body)
  if (lineErr) return lineErr

  if (body.status === 'approved' && existing.status !== 'approved') {
    const approvalLines = 'lines' in body ? normalizeLines(body.lines) : await fetchPurchaseLines(pool, id, tenantId)
    const approvalErr = await validateApprovalLines(pool, tenantId, approvalLines)
    if (approvalErr) return approvalErr
  }

  return null
}

function appendStatusSetClauses(state, existing, body, actorUserId) {
  const { setClauses, values } = state
  let { idx } = state
  setClauses.push(`status = $${idx++}`); values.push(body.status)
  if (body.status !== 'draft' && existing.finalized_at === null) {
    setClauses.push('finalized_at = NOW()')
  }
  if (body.status === 'approved' && existing.status !== 'approved') {
    setClauses.push(`approved_by_user_id = $${idx++}`); values.push(actorUserId)
  }
  return idx
}

async function appendTotalsSetClauses(client, id, tenantId, state) {
  const { setClauses, values } = state
  let { idx } = state
  const currentLines = await fetchPurchaseLines(client, id, tenantId)
  const totals = computePurchaseTotals({ lines: currentLines })
  setClauses.push(`subtotal_cents = $${idx++}`); values.push(totals.subtotalCents)
  setClauses.push(`tax_cents = $${idx++}`); values.push(totals.taxCents)
  setClauses.push(`total_cents = $${idx++}`); values.push(totals.totalCents)
  return idx
}

function mapPatchError(err) {
  if (isUniqueViolation(err)) return { error: RECEIPT_TAKEN_ERROR }
  const mapped = ledgerErrorResult(err)
  if (mapped) return mapped
  throw err
}

// ---------- register payment ----------

export async function registerPayment(pool, tenantId, id, body, actorUserId = null) {
  const existing = await fetchPurchase(pool, tenantId, id)
  if (!existing) return { error: { status: 404, body: { error: 'Not found' } } }

  const preconditionErr = validatePaymentPreconditions(existing)
  if (preconditionErr) return preconditionErr

  const paidOn = body.paid_on ?? new Date().toISOString().slice(0, 10)
  if (!isValidIsoDate(paidOn)) return { error: { status: 400, body: { error: 'Invalid paid_on' } } }

  const methodResult = await resolvePaymentMethod(pool, tenantId, body)
  if (methodResult.error) return methodResult
  const { method, paidByBandMemberId } = methodResult

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE purchases
          SET status = 'paid',
              paid_at = $1,
              payment_method = $2,
              paid_by_band_member_id = $3,
              payment_registered_by_user_id = $4,
              updated_at = NOW()
        WHERE id = $5 AND tenant_id = $6`,
      [paidOn, method, paidByBandMemberId, actorUserId, id, tenantId],
    )
    await postBillPaid(client, tenantId, {
      ...existing,
      paid_at: paidOn,
      payment_method: method,
      paid_by_band_member_id: paidByBandMemberId,
    }, { actorUserId })
    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    throw err
  } finally {
    client.release()
  }
}

function validatePaymentPreconditions(existing) {
  if (existing.status === 'draft') {
    return { error: { status: 409, body: { error: 'Approve the purchase before registering payment', code: 'not_approved' } } }
  }
  // Already paid: re-registering would change payment_method/payee while the
  // original `paid` journal stays put (postJournal is idempotent on the source
  // key), desyncing the ledger — e.g. flipping bank→member would fabricate member
  // debt no liability journal ever created. A reimbursed purchase is doubly locked.
  if (existing.status === 'paid') {
    const code = existing.reimbursement_id == null ? 'already_paid' : 'purchase_reimbursed'
    return { error: { status: 409, body: { error: 'Purchase is already paid', code } } }
  }
  return null
}

// ---------- reads / composition ----------

export async function listPurchases(db, tenantId, query) {
  const period = buildPeriodWhere(query, 'p.receipt_date')
  if (period.error) return { error: { status: 400, body: { error: period.error } } }
  return { purchases: await listPurchaseRows(db, tenantId, period.sql, period.values) }
}

export async function listPeriods(db, tenantId) {
  return listPurchasePeriods(db, tenantId)
}

// Composes a purchase with its lines (and optionally attachments). Used both for
// GET /:id and to shape the response after create/patch/payment.
export async function getPurchaseDetail(db, tenantId, id, { withAttachments = false } = {}) {
  const purchase = await fetchPurchase(db, tenantId, id)
  if (!purchase) return { error: { status: 404, body: { error: 'Not found' } } }
  const lines = await fetchPurchaseLines(db, id, tenantId)
  if (!withAttachments) return { purchase: { ...purchase, lines } }
  const attachments = await fetchPurchaseAttachments(db, id, tenantId)
  return { purchase: { ...purchase, lines, attachments } }
}

// ---------- delete ----------

export async function deletePurchase(db, tenantId, id) {
  const status = await getPurchaseStatus(db, id, tenantId)
  if (status === null) return { error: { status: 404, body: { error: 'Not found' } } }
  if (status !== 'draft') {
    return { error: { status: 409, body: { error: 'Only draft purchases can be deleted', code: 'purchase_finalized' } } }
  }
  // Collect attachment object keys before the row (and its cascading
  // purchase_attachments rows, migration 076) is deleted, otherwise the RustFS
  // objects are orphaned with no DB reference left to find them by.
  const attachments = await fetchPurchaseAttachments(db, id, tenantId)
  await deletePurchaseRow(db, id, tenantId)
  for (const { object_key } of attachments) {
    safeRemove(object_key, 'Failed to delete purchase attachment object:')
  }
  return {}
}

export async function deletePurchaseAttachment(db, tenantId, purchaseId, attachmentId) {
  const objectKey = await deleteAttachmentReturningKey(db, attachmentId, purchaseId, tenantId)
  if (!objectKey) return { error: { status: 404, body: { error: 'Not found' } } }
  safeRemove(objectKey, 'Failed to delete purchase attachment object:')
  return {}
}

async function resolvePaymentMethod(pool, tenantId, body) {
  // Bank (default) or band-member payment. Member-paid purchases clear accounts
  // payable into the configured reimbursement liability account.
  const method = body.method ?? 'bank'
  if (method !== 'bank' && method !== 'member') {
    return { error: { status: 400, body: { error: 'Invalid method', code: 'invalid_method' } } }
  }
  let paidByBandMemberId = null
  if (method === 'member') {
    if (body.paid_by_band_member_id == null) {
      return { error: { status: 400, body: { error: 'paid_by_band_member_id is required for member payments', code: 'paid_by_required' } } }
    }
    const member = await validateBandMemberForTenant(pool, body.paid_by_band_member_id, tenantId)
    if (member === null) return { error: { status: 400, body: { error: 'Invalid paid_by_band_member_id' } } }
    paidByBandMemberId = member.id
  }
  return { method, paidByBandMemberId }
}
