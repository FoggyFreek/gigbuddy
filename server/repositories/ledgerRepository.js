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
       bm.name AS reimbursement_member_name,
       COALESCE(vr.year, vrr.year) AS vat_return_year,
       COALESCE(vr.quarter, vrr.quarter) AS vat_return_quarter,
       vrp.direction AS vat_payment_direction,
       mp.name AS merch_sale_product_name,
       ms.quantity AS merch_sale_quantity,
       ms.unit_price_incl_cents AS merch_sale_unit_price_incl_cents`

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
    ON bm.id = r.band_member_id AND bm.tenant_id = r.tenant_id
  LEFT JOIN vat_returns vr
    ON lt.source_type = 'vat_settlement' AND vr.id = lt.source_id AND vr.tenant_id = lt.tenant_id
  LEFT JOIN vat_return_payments vrp
    ON lt.source_type = 'vat_settlement_payment' AND vrp.id = lt.source_id AND vrp.tenant_id = lt.tenant_id
  LEFT JOIN vat_returns vrr
    ON vrr.id = vrp.vat_return_id AND vrr.tenant_id = vrp.tenant_id
  LEFT JOIN merch_sales ms
    ON lt.source_type = 'merch_sale' AND ms.id = lt.source_id AND ms.tenant_id = lt.tenant_id
  LEFT JOIN products mp
    ON mp.id = ms.product_id AND mp.tenant_id = ms.tenant_id`

// Open-period voids (the voided original and its ledger_transaction/void
// reverser) are excluded from every financial aggregation; they stay visible
// in the browser via "Show voided". Reversals (closed-period corrections) are
// NOT excluded — they net the mistake out forward and must show in reports.
// Used in queries that already join ledger_transactions AS lt.
const EXCLUDE_VOIDED_SQL =
  "AND lt.voided_at IS NULL AND NOT (lt.source_type = 'ledger_transaction' AND lt.source_event = 'void')"

// Same exclusion as a correlated NOT EXISTS, for the running-balance queries
// that LEFT JOIN ledger_entries directly (no lt) and must preserve their
// zero-row when accounting settings exist but the account has no entries.
const NOT_VOIDED_EXISTS_SQL = `AND NOT EXISTS (
           SELECT 1 FROM ledger_transactions lt
            WHERE lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
              AND (lt.voided_at IS NOT NULL
                   OR (lt.source_type = 'ledger_transaction' AND lt.source_event = 'void')))`

const EMPTY_PERIOD = Object.freeze({ sql: '', values: [] })

// Transactions in the (optional) date range with their gross amount (sum of
// the debit side, in cents) and the joined source-doc fields.
// `period` is the { sql, values } pair from buildPeriodWhere(query, 'lt.entry_date').
export async function listTransactions(executor, tenantId, period = EMPTY_PERIOD) {
  const { rows } = await executor.query(
    `SELECT lt.id, to_char(lt.entry_date, 'YYYY-MM-DD') AS entry_date,
            lt.description, lt.source_type, lt.source_id, lt.source_event,
            lt.created_at, lt.voided_at,
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
        ${EXCLUDE_VOIDED_SQL}
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
            ${EXCLUDE_VOIDED_SQL}
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
        ${NOT_VOIDED_EXISTS_SQL}
      WHERE tas.tenant_id = $1`,
    [tenantId],
  )
  return rows[0]?.balance_cents ?? 0
}

// Merch revenue/COGS movement inside [from, toExclusive) on the tenant's
// configured merch accounts. Revenue grows with credits, COGS with debits.
// Zeros when accounting settings or the merch account codes are missing.
export async function merchTotals(executor, tenantId, { from, toExclusive }) {
  const { rows } = await executor.query(
    `SELECT COALESCE(SUM(e.credit_cents - e.debit_cents)
              FILTER (WHERE e.account_code = tas.merch_revenue_account_code), 0)::int AS revenue_cents,
            COALESCE(SUM(e.debit_cents - e.credit_cents)
              FILTER (WHERE e.account_code = tas.merch_cogs_account_code), 0)::int AS cogs_cents
       FROM tenant_accounting_settings tas
       LEFT JOIN LATERAL (
         SELECT le.account_code, le.debit_cents, le.credit_cents
           FROM ledger_entries le
           JOIN ledger_transactions lt
             ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
          WHERE le.tenant_id = tas.tenant_id
            AND lt.entry_date >= $2::date
            AND lt.entry_date < $3::date
            ${EXCLUDE_VOIDED_SQL}
       ) e ON true
      WHERE tas.tenant_id = $1
      GROUP BY tas.tenant_id`,
    [tenantId, from, toExclusive],
  )
  return rows[0] || { revenue_cents: 0, cogs_cents: 0 }
}

// Point-in-time value of the merch inventory account (an asset: debits
// increase it). A running total like the bank balance, not a period movement.
export async function merchInventoryValue(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT COALESCE(SUM(le.debit_cents - le.credit_cents), 0)::int AS value_cents
       FROM tenant_accounting_settings tas
       LEFT JOIN ledger_entries le
         ON le.tenant_id = tas.tenant_id
        AND le.account_code = tas.merch_inventory_account_code
        ${NOT_VOIDED_EXISTS_SQL}
      WHERE tas.tenant_id = $1`,
    [tenantId],
  )
  return rows[0]?.value_cents ?? 0
}

// Signed running balances of the configured input/output VAT accounts as of a
// date (entry_date <= asOf). Because each VAT settlement posts reversals back
// into these accounts, the running balance equals exactly the unsettled
// accumulation. Output VAT (a liability) grows with credits, input VAT (an
// asset) with debits; either can go negative in a credit-heavy period.
export async function vatAccountBalances(executor, tenantId, { asOf }) {
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
            AND lt.entry_date <= $2::date
            ${EXCLUDE_VOIDED_SQL}
       ) e ON true
      WHERE tas.tenant_id = $1
      GROUP BY tas.tenant_id`,
    [tenantId, asOf],
  )
  return rows[0] || { output_cents: 0, input_cents: 0 }
}

// Per-account debit/credit totals of entries inside [from, toExclusive),
// joined to the chart of accounts. Accounts without activity are absent.
export async function accountActivity(executor, tenantId, { from, toExclusive }) {
  const { rows } = await executor.query(
    `SELECT coa.code, coa.name, coa.type,
            COALESCE(SUM(le.debit_cents), 0)::int AS debit_cents,
            COALESCE(SUM(le.credit_cents), 0)::int AS credit_cents
       FROM ledger_entries le
       JOIN ledger_transactions lt
         ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
       JOIN chart_of_accounts coa
         ON coa.tenant_id = le.tenant_id AND coa.code = le.account_code
      WHERE le.tenant_id = $1
        AND lt.entry_date >= $2::date
        AND lt.entry_date < $3::date
        ${EXCLUDE_VOIDED_SQL}
      GROUP BY coa.code, coa.name, coa.type
      ORDER BY coa.code`,
    [tenantId, from, toExclusive],
  )
  return rows
}

// Per-account running balances (debit - credit, in cents) of all entries
// before toExclusive — the closing balances backing the balance sheet.
export async function accountBalancesBefore(executor, tenantId, toExclusive) {
  const { rows } = await executor.query(
    `SELECT coa.code, coa.name, coa.type,
            COALESCE(SUM(le.debit_cents - le.credit_cents), 0)::int AS balance_cents
       FROM ledger_entries le
       JOIN ledger_transactions lt
         ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
       JOIN chart_of_accounts coa
         ON coa.tenant_id = le.tenant_id AND coa.code = le.account_code
      WHERE le.tenant_id = $1
        AND lt.entry_date < $2::date
        ${EXCLUDE_VOIDED_SQL}
      GROUP BY coa.code, coa.name, coa.type
      ORDER BY coa.code`,
    [tenantId, toExclusive],
  )
  return rows
}

// Every journal line inside [from, toExclusive), flattened for the report
// exports (the line-level backing detail a tax filing wants attached).
export async function reportEntryLines(executor, tenantId, { from, toExclusive }) {
  const { rows } = await executor.query(
    `SELECT to_char(lt.entry_date, 'YYYY-MM-DD') AS entry_date,
            lt.id AS transaction_id, lt.description,
            lt.source_type, lt.source_event,
            le.account_code, coa.name AS account_name,
            le.debit_cents, le.credit_cents, le.memo
       FROM ledger_entries le
       JOIN ledger_transactions lt
         ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
       LEFT JOIN chart_of_accounts coa
         ON coa.tenant_id = le.tenant_id AND coa.code = le.account_code
      WHERE le.tenant_id = $1
        AND lt.entry_date >= $2::date
        AND lt.entry_date < $3::date
        ${EXCLUDE_VOIDED_SQL}
      ORDER BY lt.entry_date ASC, lt.id ASC, le.id ASC`,
    [tenantId, from, toExclusive],
  )
  return rows
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
            lt.voided_at, lt.voided_by_transaction_id, lt.reversed_by_transaction_id,
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

// The transaction posted for a specific source event, or null. Used when a
// domain void/reversal needs to find and mark the original it compensates.
export async function getTransactionBySource(executor, tenantId, sourceType, sourceId, sourceEvent) {
  const { rows } = await executor.query(
    `SELECT id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
            voided_at, voided_by_transaction_id, reversed_by_transaction_id
       FROM ledger_transactions
      WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3 AND source_event = $4`,
    [tenantId, sourceType, sourceId, sourceEvent],
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

// Display name for report export headers/filenames (formal name, else band name).
export async function getTenantDisplayName(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT COALESCE(formal_name, band_name) AS name FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0]?.name || ''
}
