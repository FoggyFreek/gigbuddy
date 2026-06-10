// Purchase domain logic. Route handlers stay thin and delegate here.
//
// Functions return a discriminated result so the HTTP layer can map outcomes
// to status codes without knowing the rules:
//   { error: { status, body } }   — caller should respond with that status/body
//   anything else                 — success payload (see each function)
import { computePurchaseTotals } from '../../shared/purchaseTotals.js'
import {
  fetchPurchase,
  fetchPurchaseLines,
  nextPurchaseNumber,
  insertPurchaseLines,
  replacePurchaseLines,
  validateContactIdForTenant,
  fetchValidExpenseCodes,
  validateBandMemberForTenant,
} from '../repositories/purchaseRepository.js'
import {
  CONTENT_FIELDS_SET,
  FINALIZED_LOCKED_FIELDS_SET,
  SIMPLE_PATCH_FIELDS,
  STATUS_VALUES,
  normalizeLines,
  parseReceiptNumber,
} from '../validators/purchaseValidators.js'
import {
  AccountingNotConfiguredError,
  loadAccountingSettings,
  postBillAccrued,
  postBillPaid,
} from './ledgerService.js'

// Validates any explicit per-line account codes against the tenant chart: each
// must exist, be active, and be an expense/COGS account. Lines without a code
// fall back to the tenant default expense account at posting time.
async function validateLineAccounts(executor, tenantId, lines) {
  const codes = lines.map((l) => l.account_code).filter(Boolean)
  if (!codes.length) return null
  const valid = await fetchValidExpenseCodes(executor, tenantId, codes)
  const invalid = codes.find((c) => !valid.has(c))
  if (invalid) {
    return { error: { status: 400, body: { error: 'Invalid account_code', code: 'invalid_account_code', account_code: invalid } } }
  }
  return null
}

const FINALIZED_ERROR = { status: 409, body: { error: 'Purchase is finalized', code: 'purchase_finalized' } }
const RECEIPT_TAKEN_ERROR = { status: 409, body: { error: 'Receipt number already in use', code: 'receipt_number_taken' } }
const USE_PAYMENT_ENDPOINT_ERROR = { status: 409, body: { error: 'Use the payment endpoint to mark a purchase paid', code: 'use_payment_endpoint' } }

function isUniqueViolation(err) {
  return err && err.code === '23505'
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

export async function createPurchase(pool, tenantId, body) {
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

  const receiptDate = body.receipt_date || new Date().toISOString().slice(0, 10)
  const dueDate = body.due_date || null
  const currency = String(body.currency || 'EUR').trim() || 'EUR'

  // Only draft/approved may be set on create; paying goes through the payment endpoint.
  let status = 'draft'
  if (body.status !== undefined) {
    if (body.status !== 'draft' && body.status !== 'approved') {
      return { error: { status: 400, body: { error: 'Invalid status' } } }
    }
    status = body.status
  }

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
    const { rows } = await client.query(
      `INSERT INTO purchases (
         tenant_id, receipt_number, supplier_name, supplier_contact_id,
         receipt_date, due_date, currency, memo,
         subtotal_cents, tax_cents, total_cents,
         status, finalized_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8,
         $9, $10, $11,
         $12, ${status === 'approved' ? 'NOW()' : 'NULL'}
       ) RETURNING id`,
      [
        tenantId, receiptNumber, supplierName, supplierContactId,
        receiptDate, dueDate, currency, body.memo || null,
        totals.subtotalCents, totals.taxCents, totals.totalCents,
        status,
      ],
    )
    purchaseId = rows[0].id
    await insertPurchaseLines(client, purchaseId, tenantId, lines)

    // Approving a bill accrues the expense + payable. Draft bills post nothing.
    if (status === 'approved') {
      const purchaseRow = {
        id: purchaseId,
        receipt_number: receiptNumber,
        supplier_name: supplierName,
        supplier_contact_id: supplierContactId,
        receipt_date: receiptDate,
        tax_cents: totals.taxCents,
        total_cents: totals.totalCents,
      }
      await postBillAccrued(client, tenantId, purchaseRow, lines)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err instanceof AccountingNotConfiguredError) {
      return { error: { status: err.status, body: { error: err.message, code: err.code, field: err.field } } }
    }
    throw err
  } finally {
    client.release()
  }

  return { purchaseId }
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

export async function applyPurchasePatch(pool, tenantId, id, body) {
  const existing = await fetchPurchase(pool, tenantId, id)
  if (!existing) return { error: { status: 404, body: { error: 'Not found' } } }

  if (body.status !== undefined) {
    if (!STATUS_VALUES.has(body.status)) return { error: { status: 400, body: { error: 'Invalid status' } } }
    if (body.status === 'paid') return { error: USE_PAYMENT_ENDPOINT_ERROR }
  }

  const requestedLockedFields = Object.keys(body).filter((k) => FINALIZED_LOCKED_FIELDS_SET.has(k))
  if (existing.finalized_at !== null && requestedLockedFields.length > 0) {
    return { error: FINALIZED_ERROR }
  }

  let supplierContactId
  if ('supplier_contact_id' in body) {
    if (body.supplier_contact_id == null) {
      supplierContactId = null
    } else {
      supplierContactId = await validateContactIdForTenant(pool, body.supplier_contact_id, tenantId)
      if (supplierContactId === null) return { error: { status: 400, body: { error: 'Invalid supplier_contact_id' } } }
    }
  }

  if ('receipt_number' in body && parseReceiptNumber(body.receipt_number) === null) {
    return { error: { status: 400, body: { error: 'Invalid receipt_number' } } }
  }

  if ('lines' in body) {
    const accountErr = await validateLineAccounts(pool, tenantId, normalizeLines(body.lines))
    if (accountErr) return accountErr
  }

  if (body.status === 'approved' && existing.status !== 'approved') {
    const approvalLines = 'lines' in body ? normalizeLines(body.lines) : await fetchPurchaseLines(pool, id, tenantId)
    const approvalErr = await validateApprovalLines(pool, tenantId, approvalLines)
    if (approvalErr) return approvalErr
  }

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
      const currentLines = await fetchPurchaseLines(client, id, tenantId)
      const totals = computePurchaseTotals({ lines: currentLines })
      setClauses.push(`subtotal_cents = $${idx++}`); values.push(totals.subtotalCents)
      setClauses.push(`tax_cents = $${idx++}`); values.push(totals.taxCents)
      setClauses.push(`total_cents = $${idx++}`); values.push(totals.totalCents)
    }

    if (body.status !== undefined) {
      setClauses.push(`status = $${idx++}`); values.push(body.status)
      if (body.status !== 'draft' && existing.finalized_at === null) {
        setClauses.push('finalized_at = NOW()')
      }
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
      await postBillAccrued(client, tenantId, purchaseRow, currentLines)
    }

    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (isUniqueViolation(err)) return { error: RECEIPT_TAKEN_ERROR }
    if (err instanceof AccountingNotConfiguredError) {
      return { error: { status: err.status, body: { error: err.message, code: err.code, field: err.field } } }
    }
    throw err
  } finally {
    client.release()
  }
}

// ---------- register payment ----------

export async function registerPayment(pool, tenantId, id, body) {
  const existing = await fetchPurchase(pool, tenantId, id)
  if (!existing) return { error: { status: 404, body: { error: 'Not found' } } }
  if (existing.status === 'draft') {
    return { error: { status: 409, body: { error: 'Approve the purchase before registering payment', code: 'not_approved' } } }
  }

  const paidOn = body.paid_on ?? new Date().toISOString().slice(0, 10)
  if (!isValidIsoDate(paidOn)) return { error: { status: 400, body: { error: 'Invalid paid_on' } } }

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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE purchases
          SET status = 'paid',
              paid_at = $1,
              payment_method = $2,
              paid_by_band_member_id = $3,
              updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5`,
      [paidOn, method, paidByBandMemberId, id, tenantId],
    )
    await postBillPaid(client, tenantId, {
      ...existing,
      paid_at: paidOn,
      payment_method: method,
      paid_by_band_member_id: paidByBandMemberId,
    })
    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err instanceof AccountingNotConfiguredError) {
      return { error: { status: err.status, body: { error: err.message, code: err.code, field: err.field } } }
    }
    throw err
  } finally {
    client.release()
  }
}
