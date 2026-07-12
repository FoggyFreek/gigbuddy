const RETURN_COLUMNS = `
  id, tenant_id, year, quarter,
  to_char(period_from, 'YYYY-MM-DD') AS period_from,
  to_char(period_to, 'YYYY-MM-DD') AS period_to,
  input_vat_cents, output_vat_cents, net_cents, direction,
  settlement_account_code,
  to_char(due_date, 'YYYY-MM-DD') AS due_date,
  notes, filed_at, created_by_user_id`

export async function vatReturnExists(executor, tenantId, year, quarter) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM vat_returns WHERE tenant_id = $1 AND year = $2 AND quarter = $3',
    [tenantId, year, quarter],
  )
  return rowCount > 0
}

export async function insertVatReturn(executor, tenantId, vatReturn) {
  const { rows } = await executor.query(
    `INSERT INTO vat_returns (
       tenant_id, year, quarter, period_from, period_to,
       input_vat_cents, output_vat_cents, net_cents, direction,
       settlement_account_code, due_date, notes, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING ${RETURN_COLUMNS}`,
    [tenantId, vatReturn.year, vatReturn.quarter, vatReturn.periodFrom, vatReturn.periodTo,
      vatReturn.inputVatCents, vatReturn.outputVatCents, vatReturn.netCents, vatReturn.direction,
      vatReturn.settlementAccountCode, vatReturn.dueDate, vatReturn.notes, vatReturn.createdByUserId],
  )
  return rows[0]
}

export async function closeBooksThrough(executor, tenantId, date) {
  await executor.query(
    `UPDATE tenant_accounting_settings
        SET books_closed_through = GREATEST(COALESCE(books_closed_through, $2::date), $2::date),
            updated_at = NOW()
      WHERE tenant_id = $1`,
    [tenantId, date],
  )
}

export async function lockVatReturn(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT id, net_cents, direction, settlement_account_code
       FROM vat_returns WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [vatReturnId, tenantId],
  )
  return rows[0] || null
}

export async function sumVatReturnPayments(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS paid_cents
       FROM vat_return_payments WHERE vat_return_id = $1 AND tenant_id = $2`,
    [vatReturnId, tenantId],
  )
  return rows[0].paid_cents
}

export async function getAccountType(executor, tenantId, accountCode) {
  const { rows } = await executor.query(
    'SELECT type FROM chart_of_accounts WHERE tenant_id = $1 AND code = $2',
    [tenantId, accountCode],
  )
  return rows[0]?.type ?? null
}

export async function insertVatReturnPayment(executor, tenantId, vatReturnId, payment) {
  const { rows } = await executor.query(
    `INSERT INTO vat_return_payments (
       tenant_id, vat_return_id, amount_cents, direction, bank_account_code, paid_on, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, tenant_id, vat_return_id, amount_cents, direction, bank_account_code,
               to_char(paid_on, 'YYYY-MM-DD') AS paid_on, created_by_user_id, created_at`,
    [tenantId, vatReturnId, payment.amountCents, payment.direction, payment.bankAccountCode,
      payment.paidOn, payment.createdByUserId],
  )
  return rows[0]
}

export async function listVatReturns(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${RETURN_COLUMNS},
            (SELECT COALESCE(SUM(p.amount_cents), 0)::int
               FROM vat_return_payments p
              WHERE p.vat_return_id = vat_returns.id AND p.tenant_id = vat_returns.tenant_id) AS paid_cents
       FROM vat_returns
      WHERE tenant_id = $1
      ORDER BY year DESC, quarter DESC`,
    [tenantId],
  )
  return rows
}

export async function fetchVatReturn(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT ${RETURN_COLUMNS} FROM vat_returns WHERE id = $1 AND tenant_id = $2`,
    [vatReturnId, tenantId],
  )
  return rows[0] || null
}

export async function listVatReturnPayments(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT id, amount_cents, direction, bank_account_code,
            to_char(paid_on, 'YYYY-MM-DD') AS paid_on, created_at
       FROM vat_return_payments
      WHERE vat_return_id = $1 AND tenant_id = $2
      ORDER BY paid_on ASC, id ASC`,
    [vatReturnId, tenantId],
  )
  return rows
}

export async function findFilingTransactionId(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT id FROM ledger_transactions
      WHERE tenant_id = $1 AND source_type = 'vat_settlement' AND source_id = $2 AND source_event = 'filed'`,
    [tenantId, vatReturnId],
  )
  return rows[0]?.id ?? null
}
