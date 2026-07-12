// Data access for the bank-statement importer. Each function takes an `executor`
// (pool or transaction client) and is tenant-scoped. The importer service owns
// transactions and locking; this module is pure SQL.

// ---------- imports ----------

export async function findImportByHash(executor, tenantId, fileHash) {
  const { rows } = await executor.query(
    'SELECT * FROM bank_statement_imports WHERE tenant_id = $1 AND file_hash = $2',
    [tenantId, fileHash],
  )
  return rows[0] || null
}

export async function insertImport(executor, tenantId, imp) {
  const { rows } = await executor.query(
    `INSERT INTO bank_statement_imports
       (tenant_id, filename, format, currency, statement_ref, account_iban, file_hash,
        opening_balance_cents, opening_balance_date, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      tenantId, imp.filename, imp.format, imp.currency, imp.statementRef, imp.accountIban, imp.fileHash,
      imp.openingBalanceCents ?? null, imp.openingBalanceDate ?? null, imp.createdByUserId ?? null,
    ],
  )
  return rows[0]
}

export async function fetchImport(executor, tenantId, importId) {
  const { rows } = await executor.query(
    'SELECT * FROM bank_statement_imports WHERE id = $1 AND tenant_id = $2',
    [importId, tenantId],
  )
  return rows[0] || null
}

export async function lockImport(executor, tenantId, importId) {
  const { rows } = await executor.query(
    `SELECT * FROM bank_statement_imports
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE`,
    [importId, tenantId],
  )
  return rows[0] || null
}

// A non-pending decision or a durable Mollie reconciliation operation means
// processing has started and the staged rows must remain as audit/source data.
export async function importHasCommittedLines(executor, tenantId, importId) {
  const { rows } = await executor.query(
    `SELECT EXISTS (
       SELECT 1
         FROM bank_statement_lines bsl
         LEFT JOIN bank_mollie_reconciliation_operations bmro
           ON bmro.tenant_id = bsl.tenant_id
          AND bmro.bank_statement_line_id = bsl.id
        WHERE bsl.tenant_id = $1 AND bsl.import_id = $2
          AND (bsl.status NOT IN ('pending', 'skipped_currency') OR bmro.id IS NOT NULL)
     ) AS has_committed_lines`,
    [tenantId, importId],
  )
  return rows[0].has_committed_lines
}

export async function deleteImport(executor, tenantId, importId) {
  await executor.query(
    'DELETE FROM bank_statement_imports WHERE id = $1 AND tenant_id = $2',
    [importId, tenantId],
  )
}

export async function markImportCommitted(executor, tenantId, importId) {
  const { rows } = await executor.query(
    `UPDATE bank_statement_imports SET status = 'committed'
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [importId, tenantId],
  )
  return rows[0] || null
}

// ---------- lines ----------

export async function insertLine(executor, tenantId, importId, index, line, status) {
  const { rows } = await executor.query(
    `INSERT INTO bank_statement_lines
       (tenant_id, import_id, line_index, booking_date, value_date, amount_cents,
        direction, currency, counterparty_name, counterparty_iban, remittance_info,
        bank_ref, end_to_end_id, is_reversal, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      tenantId, importId, index, line.bookingDate, line.valueDate, line.amountCents,
      line.direction, line.currency, line.counterpartyName, line.counterpartyIban,
      line.remittance, line.bankRef, line.endToEndId, line.isReversal, status,
    ],
  )
  return rows[0]
}

export async function listLines(executor, tenantId, importId) {
  const { rows } = await executor.query(
    `SELECT * FROM bank_statement_lines
      WHERE tenant_id = $1 AND import_id = $2 ORDER BY line_index ASC`,
    [tenantId, importId],
  )
  return rows
}

// Count of lines still awaiting a decision — an import is finalized only when
// this reaches zero.
export async function countPendingLines(executor, tenantId, importId) {
  const { rows } = await executor.query(
    `SELECT COUNT(*)::int AS n FROM bank_statement_lines
      WHERE tenant_id = $1 AND import_id = $2 AND status = 'pending'`,
    [tenantId, importId],
  )
  return rows[0].n
}

// Locks a staged line for update; scoped by tenant AND import so a line can't be
// committed against the wrong import.
export async function lockLine(executor, tenantId, importId, lineId) {
  const { rows } = await executor.query(
    `SELECT * FROM bank_statement_lines
      WHERE id = $1 AND tenant_id = $2 AND import_id = $3 FOR UPDATE`,
    [lineId, tenantId, importId],
  )
  return rows[0] || null
}

export async function markLineResult(executor, tenantId, lineId, { status, ledgerTransactionId = null, matchedSourceType = null, matchedSourceId = null }) {
  await executor.query(
    `UPDATE bank_statement_lines
        SET status = $1, ledger_transaction_id = $2,
            matched_source_type = $3, matched_source_id = $4
      WHERE id = $5 AND tenant_id = $6`,
    [status, ledgerTransactionId, matchedSourceType, matchedSourceId, lineId, tenantId],
  )
}

// Candidate reference rows from a different import. The service combines these
// fields into a scoped warning identity; a bank reference alone is too weak.
export async function existingBankReferenceRows(executor, tenantId, refs, excludeImportId) {
  const wanted = refs.filter(Boolean)
  if (!wanted.length) return []
  const { rows } = await executor.query(
    `SELECT bsl.bank_ref,
            to_char(bsl.booking_date, 'YYYY-MM-DD') AS booking_date,
            bsl.amount_cents, bsl.direction, bsi.account_iban
       FROM bank_statement_lines bsl
       JOIN bank_statement_imports bsi
         ON bsi.id = bsl.import_id AND bsi.tenant_id = bsl.tenant_id
      WHERE bsl.tenant_id = $1 AND bsl.bank_ref = ANY($2)
        AND bsl.import_id <> $3`,
    [tenantId, wanted, excludeImportId],
  )
  return rows
}

// ---------- reconciliation candidates (read-only, batched) ----------

// All open (sent, unpaid, no active Mollie link) invoices — the caller matches
// them to credit lines by exact amount in memory (one query per import, not per
// line). Open documents are few, so fetching them all is cheap.
export async function listOpenInvoices(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT i.id, i.invoice_number, i.customer_name, i.total_cents, i.issue_date, i.due_date,
            i.mollie_payment_link_id, i.gig_id,
            g.event_description AS gig_event_description,
            g.event_date       AS gig_event_date,
            v.name             AS gig_venue_name,
            fv.name            AS gig_festival_name
       FROM invoices i
       LEFT JOIN gigs g   ON g.id = i.gig_id     AND g.tenant_id = i.tenant_id
       LEFT JOIN venues v ON v.id = g.venue_id   AND v.tenant_id = g.tenant_id
       LEFT JOIN venues fv ON fv.id = g.festival_id AND fv.tenant_id = g.tenant_id
      WHERE i.tenant_id = $1 AND i.status = 'sent'
      ORDER BY i.issue_date DESC`,
    [tenantId],
  )
  return rows
}

// All approved, not-yet-paid bills — matched to debit lines by exact amount.
// payment_method is only set at pay time, so it is NOT a filter here.
export async function listOpenPurchases(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, receipt_number, supplier_name, supplier_contact_id, total_cents, receipt_date
       FROM purchases
      WHERE tenant_id = $1 AND status = 'approved' AND paid_at IS NULL
      ORDER BY receipt_date DESC`,
    [tenantId],
  )
  return rows
}

// Locks an invoice for reconciliation; returns null if not found for tenant.
export async function lockInvoice(executor, tenantId, invoiceId) {
  const { rows } = await executor.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [invoiceId, tenantId],
  )
  return rows[0] || null
}

export async function markInvoicePaid(executor, tenantId, invoiceId) {
  await executor.query(
    `UPDATE invoices SET status = 'paid', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, tenantId],
  )
}

// Durable Mollie bridge. The unique line key makes reservation and retry
// idempotent; service code still revalidates the snapshotted invoice/link.
export async function reserveMollieReconciliation(executor, tenantId, lineId, invoiceId, actorUserId) {
  const { rows } = await executor.query(
    `INSERT INTO bank_mollie_reconciliation_operations
       (tenant_id, bank_statement_line_id, invoice_id, mollie_payment_link_id, created_by_user_id)
     SELECT $1, $2, $3, i.mollie_payment_link_id, $4
       FROM invoices i
      WHERE i.id = $3 AND i.tenant_id = $1 AND i.mollie_payment_link_id IS NOT NULL
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [tenantId, lineId, invoiceId, actorUserId ?? null],
  )
  if (rows[0]) return rows[0]
  return fetchMollieReconciliation(executor, tenantId, lineId)
}

export async function fetchMollieReconciliation(executor, tenantId, lineId) {
  const { rows } = await executor.query(
    `SELECT * FROM bank_mollie_reconciliation_operations
      WHERE tenant_id = $1 AND bank_statement_line_id = $2`,
    [tenantId, lineId],
  )
  return rows[0] || null
}

export async function markMollieReconciliation(executor, tenantId, operationId, status, errorCode = null) {
  await executor.query(
    `UPDATE bank_mollie_reconciliation_operations
        SET status = $1, last_error_code = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4
        AND status NOT IN ('completed', 'mollie_paid', 'conflict')`,
    [status, errorCode, operationId, tenantId],
  )
}

export async function lockMollieReconciliation(executor, tenantId, operationId) {
  const { rows } = await executor.query(
    `SELECT * FROM bank_mollie_reconciliation_operations
      WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [operationId, tenantId],
  )
  return rows[0] || null
}

export async function lockPurchase(executor, tenantId, purchaseId) {
  const { rows } = await executor.query(
    'SELECT * FROM purchases WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [purchaseId, tenantId],
  )
  return rows[0] || null
}

export async function markPurchasePaid(executor, tenantId, purchaseId, paidOn, actorUserId) {
  await executor.query(
    `UPDATE purchases
        SET status = 'paid', paid_at = $1, payment_method = 'bank',
            payment_registered_by_user_id = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4`,
    [paidOn, actorUserId ?? null, purchaseId, tenantId],
  )
}
