// Read-only data access for the ledger browser. Each function takes an
// `executor` (pool or transaction client) and is scoped by tenantId. The
// posting engine (ledgerService.js) remains the only writer.

// Source-doc joins shared by list and detail: the columns ledgerEntryTypes.js
// needs to derive Type / Receipt / Description per (source_type, source_event).
const SOURCE_JOIN_COLUMNS = `
       i.invoice_number,
       i.customer_name AS invoice_customer_name,
       p.receipt_number AS purchase_receipt_number,
       p.supplier_name AS purchase_supplier_name,
       p.memo AS purchase_memo,
       j.entry_number AS journal_entry_number,
       j.description AS journal_description,
       bm.name AS reimbursement_member_name`

const SOURCE_JOINS = `
  LEFT JOIN invoices i
    ON lt.source_type = 'invoice' AND i.id = lt.source_id AND i.tenant_id = lt.tenant_id
  LEFT JOIN purchases p
    ON lt.source_type = 'purchase' AND p.id = lt.source_id AND p.tenant_id = lt.tenant_id
  LEFT JOIN journals j
    ON lt.source_type = 'journal' AND j.id = lt.source_id AND j.tenant_id = lt.tenant_id
  LEFT JOIN reimbursements r
    ON lt.source_type = 'reimbursement' AND r.id = lt.source_id AND r.tenant_id = lt.tenant_id
  LEFT JOIN band_members bm
    ON bm.id = r.band_member_id AND bm.tenant_id = r.tenant_id`

// Transactions in the (optional) date range with their gross amount (sum of
// the debit side, in cents) and the joined source-doc fields.
// `period` is the { sql, values } pair from buildPeriodWhere(query, 'lt.entry_date').
export async function listTransactions(executor, tenantId, period = { sql: '', values: [] }) {
  const { rows } = await executor.query(
    `SELECT lt.id, to_char(lt.entry_date, 'YYYY-MM-DD') AS entry_date,
            lt.description, lt.source_type, lt.source_id, lt.source_event,
            lt.created_at,
            e.total_debit_cents,
            ${SOURCE_JOIN_COLUMNS}
       FROM ledger_transactions lt
       JOIN LATERAL (
         SELECT COALESCE(SUM(le.debit_cents), 0)::int AS total_debit_cents
           FROM ledger_entries le
          WHERE le.transaction_id = lt.id AND le.tenant_id = lt.tenant_id
       ) e ON true
       ${SOURCE_JOINS}
      WHERE lt.tenant_id = $1
        ${period.sql}
      ORDER BY lt.entry_date DESC, lt.id DESC`,
    [tenantId, ...period.values],
  )
  return rows
}

// Revenue/expense totals per calendar month inside [from, toExclusive),
// classified by the chart-of-accounts type of each entry's account. Revenue
// increases with credits; expenses (incl. cost of goods sold) with debits.
// Months without activity are absent — the service fills them with zeros.
export async function monthlyResultTotals(executor, tenantId, { from, toExclusive }) {
  const { rows } = await executor.query(
    `SELECT to_char(date_trunc('month', lt.entry_date), 'YYYY-MM') AS month_key,
            COALESCE(SUM(le.credit_cents - le.debit_cents)
              FILTER (WHERE coa.type = 'revenue'), 0)::int AS revenue_cents,
            COALESCE(SUM(le.debit_cents - le.credit_cents)
              FILTER (WHERE coa.type IN ('expense', 'cost_of_goods_sold')), 0)::int AS expense_cents
       FROM ledger_entries le
       JOIN ledger_transactions lt
         ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
       JOIN chart_of_accounts coa
         ON coa.tenant_id = le.tenant_id AND coa.code = le.account_code
      WHERE le.tenant_id = $1
        AND lt.entry_date >= $2::date
        AND lt.entry_date < $3::date
      GROUP BY 1`,
    [tenantId, from, toExclusive],
  )
  return rows
}

// Output/input VAT movement inside [from, toExclusive), on the tenant's
// configured VAT accounts. Output VAT (a liability) grows with credits, input
// VAT (an asset) with debits. Returns null when accounting settings are missing.
export async function vatTotals(executor, tenantId, { from, toExclusive }) {
  const { rows } = await executor.query(
    `SELECT COALESCE(SUM(e.credit_cents - e.debit_cents)
              FILTER (WHERE e.account_code = tas.output_vat_account_code), 0)::int AS output_cents,
            COALESCE(SUM(e.debit_cents - e.credit_cents)
              FILTER (WHERE e.account_code = tas.input_vat_account_code), 0)::int AS input_cents
       FROM tenant_accounting_settings tas
       LEFT JOIN LATERAL (
         SELECT le.account_code, le.debit_cents, le.credit_cents
           FROM ledger_entries le
           JOIN ledger_transactions lt
             ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
          WHERE le.tenant_id = tas.tenant_id
            AND lt.entry_date >= $2::date
            AND lt.entry_date < $3::date
       ) e ON true
      WHERE tas.tenant_id = $1
      GROUP BY tas.tenant_id`,
    [tenantId, from, toExclusive],
  )
  return rows[0] || null
}

// Point-in-time balance of the tenant's primary checking account (an asset:
// debits increase it). Spans all postings regardless of period — a bank
// balance is a running total, not a period movement. 0 when accounting
// settings or the checking account code are missing.
export async function checkingAccountBalance(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT COALESCE(SUM(le.debit_cents - le.credit_cents), 0)::int AS balance_cents
       FROM tenant_accounting_settings tas
       LEFT JOIN ledger_entries le
         ON le.tenant_id = tas.tenant_id
        AND le.account_code = tas.primary_checking_account_code
      WHERE tas.tenant_id = $1`,
    [tenantId],
  )
  return rows[0]?.balance_cents ?? 0
}

// Distinct entry dates for the PeriodPicker availability grid.
export async function listEntryDates(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT DISTINCT to_char(entry_date, 'YYYY-MM-DD') AS date
       FROM ledger_transactions
      WHERE tenant_id = $1
      ORDER BY date DESC`,
    [tenantId],
  )
  return rows.map((r) => r.date)
}

// Single transaction header + source-doc fields + creator name, or null.
export async function getTransaction(executor, tenantId, transactionId) {
  const { rows } = await executor.query(
    `SELECT lt.id, to_char(lt.entry_date, 'YYYY-MM-DD') AS entry_date,
            lt.description, lt.source_type, lt.source_id, lt.source_event,
            lt.created_at, lt.created_by_user_id,
            u.name AS created_by_name,
            ${SOURCE_JOIN_COLUMNS}
       FROM ledger_transactions lt
       LEFT JOIN users u ON u.id = lt.created_by_user_id
       ${SOURCE_JOINS}
      WHERE lt.id = $2 AND lt.tenant_id = $1`,
    [tenantId, transactionId],
  )
  return rows[0] || null
}

// Journal lines of one transaction, joined to the chart of accounts for names.
export async function listLines(executor, tenantId, transactionId) {
  const { rows } = await executor.query(
    `SELECT le.id, le.account_code, coa.name AS account_name, le.memo,
            le.debit_cents, le.credit_cents
       FROM ledger_entries le
       LEFT JOIN chart_of_accounts coa
         ON coa.tenant_id = le.tenant_id AND coa.code = le.account_code
      WHERE le.transaction_id = $2 AND le.tenant_id = $1
      ORDER BY le.id ASC`,
    [tenantId, transactionId],
  )
  return rows
}
