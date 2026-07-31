export async function insertLedgerTaxFacts(executor, tenantId, transactionId, facts) {
  const inserted = []
  for (const fact of facts) {
    const { rows } = await executor.query(
      `INSERT INTO ledger_tax_facts (
         tenant_id, transaction_id,
         source_line_kind, source_line_id, source_line_position,
         tax_point, direction, tax_jurisdiction_code, counterparty_country_code,
         category_code, category_version, treatment, scheme_code, rate, recovery_percent,
         taxable_base_cents, tax_amount_cents, output_vat_cents,
         deductible_input_vat_cents, non_deductible_input_vat_cents,
         classification_status
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19, $20, $21
       )
       RETURNING *`,
      [
        tenantId, transactionId,
        fact.source_line_kind ?? null, fact.source_line_id ?? null, fact.source_line_position ?? null,
        fact.tax_point, fact.direction, fact.tax_jurisdiction_code,
        fact.counterparty_country_code ?? null,
        fact.category_code, fact.category_version, fact.treatment, fact.scheme_code ?? null,
        fact.rate, fact.recovery_percent ?? 0,
        fact.taxable_base_cents, fact.tax_amount_cents, fact.output_vat_cents ?? 0,
        fact.deductible_input_vat_cents ?? 0, fact.non_deductible_input_vat_cents ?? 0,
        fact.classification_status ?? 'confirmed',
      ],
    )
    inserted.push(rows[0])
  }
  return inserted
}

export async function listTransactionTaxFacts(executor, tenantId, transactionId) {
  const { rows } = await executor.query(
    `SELECT * FROM ledger_tax_facts
      WHERE tenant_id = $1 AND transaction_id = $2
      ORDER BY source_line_position NULLS LAST, id`,
    [tenantId, transactionId],
  )
  return rows
}

export async function listUnreportedTaxFacts(executor, tenantId, {
  jurisdiction,
  from,
  to,
}) {
  const { rows } = await executor.query(
    `SELECT f.*,
            to_char(f.tax_point, 'YYYY-MM-DD') AS tax_point,
            lt.entry_date,
            lt.description AS transaction_description,
            CASE WHEN lt.source_type = 'merch_sale'
              THEN COALESCE(ms.gross_incl_cents, ms.quantity * ms.unit_price_incl_cents)
              ELSE totals.transaction_amount_cents
            END::int AS transaction_amount_cents,
            lt.source_type,
            lt.source_id,
            lt.source_event
       FROM ledger_tax_facts f
       JOIN ledger_transactions lt
         ON lt.id = f.transaction_id AND lt.tenant_id = f.tenant_id
       LEFT JOIN merch_sales ms
         ON lt.source_type = 'merch_sale'
        AND ms.id = lt.source_id
        AND ms.tenant_id = lt.tenant_id
       JOIN LATERAL (
         SELECT COALESCE(SUM(le.debit_cents), 0)::int AS transaction_amount_cents
           FROM ledger_entries le
          WHERE le.transaction_id = lt.id AND le.tenant_id = lt.tenant_id
       ) totals ON true
       LEFT JOIN vat_return_tax_facts rtf
         ON rtf.tax_fact_id = f.id AND rtf.tenant_id = f.tenant_id
      WHERE f.tenant_id = $1
        AND f.tax_jurisdiction_code = $2
        AND f.tax_point <= $3::date
        AND rtf.tax_fact_id IS NULL
        AND lt.voided_at IS NULL
        AND NOT (lt.source_type = 'ledger_transaction' AND lt.source_event = 'void')
      ORDER BY f.tax_point, f.id`,
    [tenantId, jurisdiction, to],
  )
  return rows.map((row) => ({
    ...row,
    inclusion_kind: row.tax_point < from ? 'amendment' : 'period',
  }))
}

export async function reconcileTaxFactsToLedger(executor, tenantId, factIds, { asOf }) {
  if (!factIds.length) {
    // Do not return early: a VAT-account balance with no tax fact is exactly
    // the legacy/manual movement this reconciliation must surface.
  }
  const { rows } = await executor.query(
    `WITH selected AS (
       SELECT f.*
         FROM ledger_tax_facts f
        WHERE f.tenant_id = $1 AND f.id = ANY($2::bigint[])
     ), settings AS (
       SELECT output_vat_account_code, input_vat_account_code
         FROM tenant_accounting_settings WHERE tenant_id = $1
     ), ledger AS (
       SELECT
         COALESCE(SUM(activity.credit_cents - activity.debit_cents)
           FILTER (WHERE activity.account_code = s.output_vat_account_code), 0)::int AS output_ledger_cents,
         COALESCE(SUM(activity.debit_cents - activity.credit_cents)
           FILTER (WHERE activity.account_code = s.input_vat_account_code), 0)::int AS input_ledger_cents,
         s.output_vat_account_code,
         s.input_vat_account_code
       FROM settings s
       LEFT JOIN LATERAL (
         SELECT le.account_code, le.debit_cents, le.credit_cents
           FROM ledger_entries le
           JOIN ledger_transactions lt
             ON lt.id = le.transaction_id AND lt.tenant_id = le.tenant_id
          WHERE le.tenant_id = $1
            AND lt.entry_date <= $3::date
            AND lt.voided_at IS NULL
            AND NOT (lt.source_type = 'ledger_transaction' AND lt.source_event = 'void')
       ) activity ON TRUE
       GROUP BY s.output_vat_account_code, s.input_vat_account_code
     ), facts AS (
       SELECT COALESCE(SUM(output_vat_cents), 0)::int AS output_fact_cents,
              COALESCE(SUM(deductible_input_vat_cents), 0)::int AS input_fact_cents
         FROM selected
     )
     SELECT facts.*, ledger.*,
            (facts.output_fact_cents - ledger.output_ledger_cents)::int AS output_difference_cents,
            (facts.input_fact_cents - ledger.input_ledger_cents)::int AS input_difference_cents
       FROM facts CROSS JOIN ledger`,
    [tenantId, factIds, asOf],
  )
  return rows[0]
}

export async function confirmLegacyTaxFact(executor, tenantId, factId, patch, actorUserId) {
  const { rows } = await executor.query(
    `UPDATE ledger_tax_facts
        SET tax_jurisdiction_code = $3,
            category_code = $4,
            category_version = $5,
            treatment = $6,
            recovery_percent = $7,
            direction = $9,
            rate = $10,
            taxable_base_cents = $11,
            tax_amount_cents = $12,
            classification_status = 'confirmed',
            confirmed_at = NOW(),
            confirmed_by_user_id = $8
      WHERE id = $1 AND tenant_id = $2
        AND classification_status IN ('legacy_inferred', 'unclassified')
        AND NOT EXISTS (
          SELECT 1 FROM vat_return_tax_facts rtf
           WHERE rtf.tenant_id = ledger_tax_facts.tenant_id
             AND rtf.tax_fact_id = ledger_tax_facts.id
        )
      RETURNING *`,
    [
      factId, tenantId, patch.tax_jurisdiction_code, patch.category_code,
      patch.category_version, patch.treatment, patch.recovery_percent, actorUserId,
      patch.direction, patch.rate, patch.taxable_base_cents, patch.tax_amount_cents,
    ],
  )
  return rows[0] || null
}

export async function fetchReviewableTaxFact(executor, tenantId, factId) {
  const { rows } = await executor.query(
    `SELECT *
       FROM ledger_tax_facts f
      WHERE f.id = $1 AND f.tenant_id = $2
        AND f.classification_status IN ('legacy_inferred', 'unclassified')
        AND NOT EXISTS (
          SELECT 1 FROM vat_return_tax_facts rtf
           WHERE rtf.tenant_id = f.tenant_id AND rtf.tax_fact_id = f.id
        )`,
    [factId, tenantId],
  )
  return rows[0] || null
}

export async function listLegacyVatTransactions(executor, tenantId = null) {
  const params = tenantId == null ? [] : [tenantId]
  const tenantFilter = tenantId == null ? '' : 'AND lt.tenant_id = $1'
  const { rows } = await executor.query(
    `SELECT lt.id AS transaction_id, lt.tenant_id, lt.entry_date,
            lt.source_type, lt.source_id, lt.source_event,
            p.country_code,
            COALESCE(SUM(le.credit_cents - le.debit_cents)
              FILTER (WHERE le.account_code = s.output_vat_account_code), 0)::int AS output_vat_cents,
            COALESCE(SUM(le.debit_cents - le.credit_cents)
              FILTER (WHERE le.account_code = s.input_vat_account_code), 0)::int AS input_vat_cents
       FROM ledger_transactions lt
       JOIN tenant_accounting_settings s ON s.tenant_id = lt.tenant_id
       JOIN tenant_accounting_profiles p ON p.tenant_id = lt.tenant_id
       JOIN ledger_entries le
         ON le.transaction_id = lt.id AND le.tenant_id = lt.tenant_id
       LEFT JOIN ledger_tax_facts f
         ON f.transaction_id = lt.id AND f.tenant_id = lt.tenant_id
      WHERE lt.voided_at IS NULL
        AND NOT (lt.source_type = 'ledger_transaction' AND lt.source_event = 'void')
        ${tenantFilter}
      GROUP BY lt.id, lt.tenant_id, lt.entry_date, lt.source_type,
               lt.source_id, lt.source_event, p.country_code
     HAVING COUNT(f.id) = 0
        AND (
          COALESCE(SUM(le.credit_cents - le.debit_cents)
            FILTER (WHERE le.account_code = s.output_vat_account_code), 0) <> 0
          OR COALESCE(SUM(le.debit_cents - le.credit_cents)
            FILTER (WHERE le.account_code = s.input_vat_account_code), 0) <> 0
        )
      ORDER BY lt.tenant_id, lt.entry_date, lt.id`,
    params,
  )
  return rows
}

export const VAT_TAX_FACT_BACKFILL_LOCK_NAMESPACE = 53003

export async function acquireVatTaxFactBackfillLock(executor, tenantId) {
  await executor.query(
    'SELECT pg_advisory_xact_lock($1, $2)',
    [VAT_TAX_FACT_BACKFILL_LOCK_NAMESPACE, tenantId],
  )
}

export async function listLegacyVatTenantIds(executor) {
  const rows = await listLegacyVatTransactions(executor)
  return [...new Set(rows.map((row) => Number(row.tenant_id)))]
}

export async function assignTaxFactToLegacyReturn(executor, tenantId, factId, taxPoint) {
  const { rows } = await executor.query(
    `INSERT INTO vat_return_tax_facts (
       tenant_id, vat_return_id, tax_fact_id, inclusion_kind
     )
     SELECT $1, vr.id, $2, 'legacy_assigned'
       FROM vat_returns vr
      WHERE vr.tenant_id = $1
        AND vr.workflow_status = 'submitted'
        AND vr.period_from <= $3::date
        AND vr.period_to >= $3::date
      ORDER BY vr.period_to
      LIMIT 1
     ON CONFLICT DO NOTHING
     RETURNING vat_return_id`,
    [tenantId, factId, taxPoint],
  )
  return rows[0]?.vat_return_id ?? null
}
