// Data-access helpers for purchases. Each takes an `executor` (a pool or a
// transaction client) so callers control transaction boundaries.

export async function countPurchasesBySupplierContact(executor, tenantId, contactId) {
  const { rows } = await executor.query(
    'SELECT COUNT(*)::int AS count FROM purchases WHERE tenant_id = $1 AND supplier_contact_id = $2',
    [tenantId, contactId],
  )
  return rows[0].count
}

export async function fetchPurchase(executor, tenantId, purchaseId) {
  const { rows } = await executor.query(
    'SELECT * FROM purchases WHERE id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  return rows[0] || null
}

export async function fetchPurchaseOwner(executor, tenantId, purchaseId) {
  const { rows } = await executor.query(
    'SELECT id, created_by_user_id FROM purchases WHERE id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  return rows[0] || null
}

export async function insertPurchaseAttachment(executor, tenantId, purchaseId, attachment) {
  const { rows } = await executor.query(
    `INSERT INTO purchase_attachments (purchase_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, object_key, original_filename, content_type, file_size, uploaded_at`,
    [purchaseId, tenantId, attachment.objectKey, attachment.originalFilename,
      attachment.contentType, attachment.fileSize],
  )
  return rows[0]
}

export async function lockProductStock(executor, tenantId, productId) {
  const { rows } = await executor.query(
    'SELECT quantity_on_hand, unit_cost_cents FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [productId, tenantId],
  )
  return rows[0] || null
}

export async function setProductStock(executor, tenantId, productId, quantity, unitCostCents) {
  await executor.query(
    `UPDATE products SET quantity_on_hand = $1, unit_cost_cents = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4`,
    [quantity, unitCostCents, productId, tenantId],
  )
}

export async function insertPurchase(executor, tenantId, purchase) {
  const approved = purchase.status === 'approved'
  const { rows } = await executor.query(
    `INSERT INTO purchases (
       tenant_id, receipt_number, supplier_name, supplier_contact_id,
       receipt_date, due_date, currency, memo,
       subtotal_cents, tax_cents, total_cents,
       status, finalized_at,
       created_by_user_id, approved_by_user_id
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9, $10, $11,
       $12, ${approved ? 'NOW()' : 'NULL'},
       $13, ${approved ? '$13' : 'NULL'}
     ) RETURNING id`,
    [tenantId, purchase.receiptNumber, purchase.supplierName, purchase.supplierContactId,
      purchase.receiptDate, purchase.dueDate, purchase.currency, purchase.memo,
      purchase.subtotalCents, purchase.taxCents, purchase.totalCents,
      purchase.status, purchase.actorUserId],
  )
  return rows[0].id
}

export async function updatePurchase(executor, tenantId, purchaseId, patch) {
  const assignments = []
  const values = []
  let index = 1
  for (const [column, value] of Object.entries(patch.fields)) {
    assignments.push(`${column} = $${index++}`)
    values.push(value)
  }
  if (patch.totals) {
    for (const [column, value] of Object.entries({
      subtotal_cents: patch.totals.subtotalCents,
      tax_cents: patch.totals.taxCents,
      total_cents: patch.totals.totalCents,
    })) {
      assignments.push(`${column} = $${index++}`)
      values.push(value)
    }
  }
  if (patch.status !== undefined) {
    assignments.push(`status = $${index++}`)
    values.push(patch.status)
    if (patch.finalize) assignments.push('finalized_at = NOW()')
    if (patch.setApprovedBy) {
      assignments.push(`approved_by_user_id = $${index++}`)
      values.push(patch.approvedByUserId)
    }
  }
  assignments.push('updated_at = NOW()')
  values.push(purchaseId, tenantId)
  await executor.query(
    `UPDATE purchases SET ${assignments.join(', ')} WHERE id = $${index} AND tenant_id = $${index + 1}`,
    values,
  )
}

export async function lockPurchase(executor, tenantId, purchaseId) {
  const { rows } = await executor.query(
    'SELECT * FROM purchases WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [purchaseId, tenantId],
  )
  return rows[0] || null
}

// Flips a purchase to paid, tenant-scoped. Returns the updated row (or null when
// no row matched) so the caller can confirm exactly one row changed before it
// posts the ledger journal — see settlePurchase.
export async function markPurchasePaid(executor, tenantId, purchaseId, { paidOn, method, paidByBandMemberId = null, registeredByUserId = null }) {
  const { rows } = await executor.query(
    `UPDATE purchases
        SET status = 'paid', paid_at = $1, payment_method = $2,
            paid_by_band_member_id = $3, payment_registered_by_user_id = $4,
            updated_at = NOW()
      WHERE id = $5 AND tenant_id = $6
      RETURNING *`,
    [paidOn, method, paidByBandMemberId, registeredByUserId, purchaseId, tenantId],
  )
  return rows[0] || null
}

export async function listImportedPaymentCandidates(executor, tenantId, purchase) {
  const { rows } = await executor.query(
    `SELECT bsl.id, to_char(bsl.booking_date, 'YYYY-MM-DD') AS booking_date,
            bsl.amount_cents, bsl.counterparty_name, bsl.counterparty_iban,
            bsl.remittance_info, bsl.ledger_transaction_id,
            CASE
              WHEN c.iban IS NOT NULL AND bsl.counterparty_iban IS NOT NULL
                AND upper(replace(c.iban, ' ', '')) = upper(replace(bsl.counterparty_iban, ' ', '')) THEN 'iban'
              WHEN lower(bsl.counterparty_name) = lower(p.supplier_name) THEN 'name'
              ELSE 'none'
            END AS supplier_match
       FROM bank_statement_lines bsl
       JOIN ledger_transactions lt
         ON lt.id = bsl.ledger_transaction_id AND lt.tenant_id = bsl.tenant_id
       JOIN purchases p ON p.id = $2 AND p.tenant_id = bsl.tenant_id
       LEFT JOIN contacts c ON c.id = p.supplier_contact_id AND c.tenant_id = p.tenant_id
      WHERE bsl.tenant_id = $1
        AND bsl.direction = 'debit'
        AND bsl.status = 'imported'
        AND bsl.amount_cents = p.total_cents
        AND lt.source_type = 'bank_statement_line'
        AND lt.source_id = bsl.id
        AND lt.source_event = 'paid'
        AND lt.voided_at IS NULL
        AND lt.reversed_by_transaction_id IS NULL
      ORDER BY CASE
                 WHEN c.iban IS NOT NULL AND bsl.counterparty_iban IS NOT NULL
                   AND upper(replace(c.iban, ' ', '')) = upper(replace(bsl.counterparty_iban, ' ', '')) THEN 0
                 WHEN lower(bsl.counterparty_name) = lower(p.supplier_name) THEN 1
                 ELSE 2
               END,
               bsl.booking_date DESC, bsl.id DESC`,
    [tenantId, purchase.id],
  )
  return rows
}

export async function lockImportedPaymentCandidate(executor, tenantId, lineId) {
  const { rows } = await executor.query(
    `SELECT bsl.*, lt.entry_date AS ledger_entry_date, lt.voided_at,
            lt.reversed_by_transaction_id, lt.source_type, lt.source_id, lt.source_event
       FROM bank_statement_lines bsl
       JOIN ledger_transactions lt
         ON lt.id = bsl.ledger_transaction_id AND lt.tenant_id = bsl.tenant_id
      WHERE bsl.id = $1 AND bsl.tenant_id = $2
      FOR UPDATE OF bsl, lt`,
    [lineId, tenantId],
  )
  return rows[0] || null
}

export async function fetchPurchaseLines(executor, purchaseId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, description, expense_category, account_code, tax_rate, amount_incl_cents, position, product_id, quantity
       FROM purchase_lines
      WHERE purchase_id = $1 AND tenant_id = $2
      ORDER BY position ASC, id ASC`,
    [purchaseId, tenantId],
  )
  return rows
}

export async function nextPurchaseNumber(executor, tenantId) {
  const { rows } = await executor.query(
    `INSERT INTO purchase_number_sequences (tenant_id, next_seq)
     VALUES ($1, 2)
     ON CONFLICT (tenant_id)
     DO UPDATE SET next_seq = purchase_number_sequences.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    [tenantId],
  )
  return rows[0].seq
}

export async function insertPurchaseLines(executor, purchaseId, tenantId, lines) {
  for (const line of lines) {
    await executor.query(
      `INSERT INTO purchase_lines (purchase_id, tenant_id, position, description, expense_category, account_code, tax_rate, amount_incl_cents, product_id, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [purchaseId, tenantId, line.position, line.description, line.expense_category, line.account_code ?? null, line.tax_rate, line.amount_incl_cents, line.product_id ?? null, line.quantity ?? null],
    )
  }
}

// Returns the subset of `codes` a purchase line may book to: active expense or
// cost-of-goods-sold accounts (the 5xxxx/6xxxx codes a bill may debit), plus
// active asset accounts explicitly flagged `is_capitalizable` (owned gear,
// vehicles) so a purchase can be capitalized onto the balance sheet rather than
// expensed. Other assets (bank, VAT, receivable, inventory) are excluded.
// The line FK only proves existence; this also enforces active + allowed type.
export async function fetchValidPurchaseLineCodes(executor, tenantId, codes) {
  const unique = [...new Set(codes.filter(Boolean))]
  if (!unique.length) return new Set()
  const { rows } = await executor.query(
    `SELECT code FROM chart_of_accounts
      WHERE tenant_id = $1 AND code = ANY($2) AND is_active
        AND (type IN ('expense', 'cost_of_goods_sold')
             OR (type = 'asset' AND is_capitalizable))`,
    [tenantId, unique],
  )
  return new Set(rows.map((r) => r.code))
}

// Returns the band member row only if it belongs to the tenant. A member-paid
// purchase may be fronted by a band member profile that has no login account.
export async function validateBandMemberForTenant(executor, rawBandMemberId, tenantId) {
  const n = Number(rawBandMemberId)
  if (!Number.isInteger(n) || n <= 0) return null
  const { rows } = await executor.query(
    'SELECT id, user_id FROM band_members WHERE id = $1 AND tenant_id = $2',
    [n, tenantId],
  )
  return rows[0] || null
}

export async function replacePurchaseLines(executor, purchaseId, tenantId, lines) {
  await executor.query(
    'DELETE FROM purchase_lines WHERE purchase_id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  await insertPurchaseLines(executor, purchaseId, tenantId, lines)
}

// Returns the subset of `ids` that exist as non-archived products of the
// tenant. The line's composite FK is the backstop; this gives a clean 400 for
// cross-tenant or archived products before any insert is attempted.
export async function fetchValidProductIds(executor, tenantId, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Set()
  const { rows } = await executor.query(
    `SELECT id FROM products
      WHERE tenant_id = $1 AND id = ANY($2) AND archived_at IS NULL`,
    [tenantId, unique],
  )
  return new Set(rows.map((r) => r.id))
}

// Returns the int id only if a contact with that (id, tenant_id) exists.
// Mirrors validateGigIdForTenant so a cross-tenant supplier is rejected up front.
export async function validateContactIdForTenant(executor, rawId, tenantId) {
  const n = Number(rawId)
  if (!Number.isInteger(n) || n <= 0) return null
  const { rowCount } = await executor.query(
    'SELECT 1 FROM contacts WHERE id = $1 AND tenant_id = $2',
    [n, tenantId],
  )
  return rowCount ? n : null
}

// List rows for the table/search. Includes the first line's description (the
// per-line description lives in purchase_lines, not on the purchase row).
// `periodSql`/`periodValues` come from buildPeriodWhere (placeholders $2+).
export async function listPurchases(executor, tenantId, periodSql, periodValues, createdByUserId = null, supplierContactId = null) {
  const params = [tenantId, ...periodValues]
  let ownerSql = ''
  if (createdByUserId != null) {
    params.push(createdByUserId)
    ownerSql = `AND p.created_by_user_id = $${params.length}`
  }
  let supplierSql = ''
  if (supplierContactId != null) {
    params.push(supplierContactId)
    supplierSql = `AND p.supplier_contact_id = $${params.length}`
  }
  const { rows } = await executor.query(
    `SELECT p.id, p.receipt_number, p.supplier_name, p.supplier_contact_id,
            p.receipt_date, p.due_date, p.currency, p.status,
            p.subtotal_cents, p.tax_cents, p.total_cents,
            p.finalized_at, p.paid_at, p.created_at, p.updated_at,
            p.payment_method, p.paid_by_band_member_id,
            fl.description
       FROM purchases p
       LEFT JOIN LATERAL (
         SELECT description FROM purchase_lines pl
          WHERE pl.purchase_id = p.id AND pl.tenant_id = p.tenant_id
          ORDER BY position ASC, id ASC
          LIMIT 1
       ) fl ON TRUE
      WHERE p.tenant_id = $1
        ${periodSql}
        ${ownerSql}
        ${supplierSql}
      ORDER BY p.receipt_date DESC, p.id DESC`,
    params,
  )
  return rows
}

// Global-search read: matches purchases on supplier name, memo, or receipt
// number (cast to text). Most recent first. Tenant-scoped like every query.
export async function searchPurchases(executor, tenantId, like, limit) {
  const { rows } = await executor.query(
    `SELECT id, receipt_number, supplier_name, total_cents, status, receipt_date
       FROM purchases
      WHERE tenant_id = $1
        AND (supplier_name ILIKE $2 OR memo ILIKE $2 OR receipt_number::text ILIKE $2)
      ORDER BY receipt_date DESC, id DESC
      LIMIT $3`,
    [tenantId, like, limit],
  )
  return rows
}

export async function listPurchasePeriods(executor, tenantId, supplierContactId = null) {
  const params = [tenantId]
  let supplierSql = ''
  if (supplierContactId != null) {
    params.push(supplierContactId)
    supplierSql = `AND supplier_contact_id = $${params.length}`
  }
  const { rows } = await executor.query(
    `SELECT DISTINCT to_char(receipt_date, 'YYYY-MM-DD') AS date
       FROM purchases
      WHERE tenant_id = $1
        AND receipt_date IS NOT NULL
        ${supplierSql}
      ORDER BY date DESC`,
    params,
  )
  return rows.map((row) => row.date)
}

export async function fetchPurchaseAttachments(executor, purchaseId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, object_key, original_filename, content_type, file_size, uploaded_at
       FROM purchase_attachments
      WHERE purchase_id = $1 AND tenant_id = $2
      ORDER BY uploaded_at ASC, id ASC`,
    [purchaseId, tenantId],
  )
  return rows
}

export async function getPurchaseStatus(executor, purchaseId, tenantId) {
  const { rows } = await executor.query(
    'SELECT status FROM purchases WHERE id = $1 AND tenant_id = $2',
    [purchaseId, tenantId],
  )
  return rows[0]?.status ?? null
}

export async function deletePurchase(executor, purchaseId, tenantId) {
  await executor.query('DELETE FROM purchases WHERE id = $1 AND tenant_id = $2', [purchaseId, tenantId])
}

export async function deleteAttachmentReturningKey(executor, attachmentId, purchaseId, tenantId) {
  const { rows } = await executor.query(
    'DELETE FROM purchase_attachments WHERE id = $1 AND purchase_id = $2 AND tenant_id = $3 RETURNING object_key',
    [attachmentId, purchaseId, tenantId],
  )
  return rows[0]?.object_key ?? null
}
