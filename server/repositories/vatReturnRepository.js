const RETURN_COLUMNS = `
  id, tenant_id, year, quarter,
  to_char(period_from, 'YYYY-MM-DD') AS period_from,
  to_char(period_to, 'YYYY-MM-DD') AS period_to,
  input_vat_cents, output_vat_cents, net_cents, direction,
  settlement_account_code,
  to_char(due_date, 'YYYY-MM-DD') AS due_date,
  notes, filed_at, created_by_user_id,
  period_key, schema_country_code, schema_version, calculation_mode,
  workflow_status, filing_frequency_snapshot,
  raw_input_vat_cents, raw_output_vat_cents, raw_net_cents,
  prepared_at, prepared_by_user_id, submitted_at, submitted_by_user_id,
  submission_reference, boxes_snapshot, reconciliation_snapshot, exceptions_snapshot`

export async function activeVatReturnForPeriod(executor, tenantId, periodFrom, periodTo) {
  const { rows } = await executor.query(
    `SELECT ${RETURN_COLUMNS}
       FROM vat_returns
      WHERE tenant_id = $1 AND period_from = $2 AND period_to = $3
        AND workflow_status <> 'superseded'
      FOR UPDATE`,
    [tenantId, periodFrom, periodTo],
  )
  return rows[0] || null
}

export async function insertPreparedVatReturn(executor, tenantId, vatReturn) {
  const { rows } = await executor.query(
    `INSERT INTO vat_returns (
       tenant_id, year, quarter, period_from, period_to, period_key,
       schema_country_code, schema_version, calculation_mode, workflow_status,
       filing_frequency_snapshot, input_vat_cents, output_vat_cents, net_cents,
       raw_input_vat_cents, raw_output_vat_cents, raw_net_cents,
       direction, settlement_account_code, due_date, notes,
       prepared_at, prepared_by_user_id, boxes_snapshot,
       reconciliation_snapshot, exceptions_snapshot, created_by_user_id, filed_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, 'category_workpaper', 'prepared',
       $9, $10, $11, $12,
       $13, $14, $15,
       $16, NULL, $17, $18,
       NOW(), $19, $20, $21, $22, $19, NULL
     )
     RETURNING ${RETURN_COLUMNS}`,
    [
      tenantId, vatReturn.year, vatReturn.quarter,
      vatReturn.periodFrom, vatReturn.periodTo, vatReturn.periodKey,
      vatReturn.schemaCountryCode, vatReturn.schemaVersion,
      vatReturn.filingFrequency,
      vatReturn.inputVatCents, vatReturn.outputVatCents, vatReturn.netCents,
      vatReturn.rawInputVatCents, vatReturn.rawOutputVatCents, vatReturn.rawNetCents,
      vatReturn.direction, vatReturn.dueDate, vatReturn.notes,
      vatReturn.actorUserId,
      JSON.stringify(vatReturn.boxes),
      JSON.stringify(vatReturn.reconciliation),
      JSON.stringify(vatReturn.exceptions),
    ],
  )
  return rows[0]
}

export async function insertVatReturnBoxes(executor, tenantId, vatReturnId, boxes) {
  for (const [boxCode, value] of Object.entries(boxes)) {
    await executor.query(
      `INSERT INTO vat_return_box_values (
         tenant_id, vat_return_id, box_code, base_raw_cents, vat_raw_cents,
         base_declared_euros, vat_declared_euros
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId, vatReturnId, boxCode,
        value.base_cents ?? 0, value.vat_cents ?? 0,
        value.base_declared_euros ?? null, value.vat_declared_euros ?? null,
      ],
    )
  }
}

export async function linkVatReturnTaxFacts(executor, tenantId, vatReturnId, facts) {
  for (const fact of facts) {
    await executor.query(
      `INSERT INTO vat_return_tax_facts (
         tenant_id, vat_return_id, tax_fact_id, inclusion_kind
       ) VALUES ($1, $2, $3, $4)`,
      [tenantId, vatReturnId, fact.id, fact.inclusion_kind],
    )
  }
}

export async function listVatReturnBoxes(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT box_code, base_raw_cents, vat_raw_cents,
            base_declared_euros, vat_declared_euros
       FROM vat_return_box_values
      WHERE tenant_id = $1 AND vat_return_id = $2
      ORDER BY box_code`,
    [tenantId, vatReturnId],
  )
  return rows
}

export async function listVatReturnFacts(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT f.*, rtf.inclusion_kind,
            to_char(f.tax_point, 'YYYY-MM-DD') AS tax_point
       FROM vat_return_tax_facts rtf
       JOIN ledger_tax_facts f
         ON f.id = rtf.tax_fact_id AND f.tenant_id = rtf.tenant_id
      WHERE rtf.tenant_id = $1 AND rtf.vat_return_id = $2
      ORDER BY f.tax_point, f.id`,
    [tenantId, vatReturnId],
  )
  return rows
}

export async function listExceptionAcknowledgements(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT exception_key, note, acknowledged_by_user_id, acknowledged_at
       FROM vat_return_exception_acknowledgements
      WHERE tenant_id = $1 AND vat_return_id = $2
      ORDER BY exception_key`,
    [tenantId, vatReturnId],
  )
  return rows
}

export async function acknowledgeVatReturnException(
  executor, tenantId, vatReturnId, exceptionKey, note, actorUserId,
) {
  const { rows } = await executor.query(
    `INSERT INTO vat_return_exception_acknowledgements (
       tenant_id, vat_return_id, exception_key, note, acknowledged_by_user_id
     )
     SELECT $1, vr.id, $3, $4, $5
      FROM vat_returns vr
      WHERE vr.id = $2 AND vr.tenant_id = $1 AND vr.workflow_status = 'prepared'
        AND EXISTS (
          SELECT 1
            FROM jsonb_array_elements(COALESCE(vr.exceptions_snapshot, '[]'::jsonb)) exception
           WHERE exception->>'key' = $3
        )
     ON CONFLICT (vat_return_id, tenant_id, exception_key)
     DO UPDATE SET note = EXCLUDED.note,
                   acknowledged_by_user_id = EXCLUDED.acknowledged_by_user_id,
                   acknowledged_at = NOW()
     RETURNING *`,
    [tenantId, vatReturnId, exceptionKey, note, actorUserId],
  )
  return rows[0] || null
}

export async function submitPreparedVatReturn(
  executor, tenantId, vatReturnId, { settlementAccountCode, reference, actorUserId },
) {
  const { rows } = await executor.query(
    `UPDATE vat_returns
        SET workflow_status = 'submitted',
            settlement_account_code = $3,
            submission_reference = $4,
            submitted_at = NOW(),
            submitted_by_user_id = $5,
            filed_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND workflow_status = 'prepared'
      RETURNING ${RETURN_COLUMNS}`,
    [vatReturnId, tenantId, settlementAccountCode, reference, actorUserId],
  )
  return rows[0] || null
}

export async function lockPreparedVatReturn(executor, tenantId, vatReturnId) {
  const { rows } = await executor.query(
    `SELECT ${RETURN_COLUMNS}
       FROM vat_returns
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE`,
    [vatReturnId, tenantId],
  )
  return rows[0] || null
}

export async function lockVatPeriodThrough(executor, tenantId, periodTo) {
  await executor.query(
    `UPDATE tenant_accounting_profiles
        SET vat_period_locked_through =
              GREATEST(COALESCE(vat_period_locked_through, $2::date), $2::date),
            updated_at = NOW()
      WHERE tenant_id = $1`,
    [tenantId, periodTo],
  )
}

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
       settlement_account_code, due_date, notes, created_by_user_id, filed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
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
    `SELECT id, net_cents, direction, settlement_account_code, workflow_status
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

// Filed returns whose quarter overlaps [from, to] (both inclusive), oldest
// first — drives the report's "was this period declared?" indicator.
export async function listVatReturnsInRange(executor, tenantId, { from, to }) {
  const { rows } = await executor.query(
    `SELECT year, quarter,
            to_char(period_from, 'YYYY-MM-DD') AS period_from,
            to_char(period_to, 'YYYY-MM-DD') AS period_to,
            to_char(filed_at, 'YYYY-MM-DD') AS filed_on,
            direction, net_cents
       FROM vat_returns
      WHERE tenant_id = $1
        AND workflow_status = 'submitted'
        AND period_from <= $3::date AND period_to >= $2::date
      ORDER BY year, quarter`,
    [tenantId, from, to],
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
