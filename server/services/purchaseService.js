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
} from '../repositories/purchaseRepository.js'
import {
  CONTENT_FIELDS_SET,
  FINALIZED_LOCKED_FIELDS_SET,
  SIMPLE_PATCH_FIELDS,
  STATUS_VALUES,
  normalizeLines,
  parseReceiptNumber,
} from '../validators/purchaseValidators.js'

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
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
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
    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (isUniqueViolation(err)) return { error: RECEIPT_TAKEN_ERROR }
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

  await pool.query(
    `UPDATE purchases SET status = 'paid', paid_at = $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3`,
    [paidOn, id, tenantId],
  )
  return {}
}
