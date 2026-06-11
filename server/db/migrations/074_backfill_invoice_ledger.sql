-- Backfill ledger journals for invoices that existed before the ledger feature.
--
-- Draft invoices are intentionally skipped: they have no accounting event yet.
-- Voided invoices are also skipped because the final row does not tell us
-- whether it was voided from draft (no journal) or from sent (sent + reversal).
-- A voided invoice has no open balance, so inventing historical revenue and a
-- reversal would be noisier than leaving it unposted.
--
-- The whole file executes as one implicit transaction (multi-statement simple
-- query), so the verification block at the end aborts the entire backfill if
-- any invoice would be skipped or any journal would be unbalanced — corrupt or
-- incomplete data must be fixed first, never silently dropped.

-- Sent/paid invoices: recognise revenue and receivable on the invoice date.
-- Net revenue is subtotal - discount, the same basis the live posting code
-- uses (ledgerService.postInvoiceSent). Rows whose stored amounts cannot form
-- a balanced journal are excluded here and caught by the verification below.
WITH candidates AS (
  SELECT
    i.id AS invoice_id,
    i.tenant_id,
    i.invoice_number,
    i.issue_date,
    i.total_cents,
    i.subtotal_cents - i.discount_cents AS net_cents,
    i.tax_cents,
    tas.receivable_account_code,
    tas.default_revenue_account_code,
    tas.output_vat_account_code
  FROM invoices i
  JOIN tenant_accounting_settings tas ON tas.tenant_id = i.tenant_id
  WHERE i.status IN ('sent', 'paid')
    AND i.total_cents > 0
    AND i.tax_cents >= 0
    AND i.subtotal_cents - i.discount_cents >= 0
    AND i.total_cents = i.subtotal_cents - i.discount_cents + i.tax_cents
    AND tas.receivable_account_code IS NOT NULL
    AND tas.default_revenue_account_code IS NOT NULL
    AND (i.tax_cents = 0 OR tas.output_vat_account_code IS NOT NULL)
),
inserted AS (
  INSERT INTO ledger_transactions (
    tenant_id, entry_date, description, source_type, source_id, source_event, created_by_user_id
  )
  SELECT
    tenant_id,
    issue_date,
    'Invoice ' || invoice_number || ' sent',
    'invoice',
    invoice_id,
    'sent',
    NULL
  FROM candidates
  ON CONFLICT (tenant_id, source_type, source_id, source_event) DO NOTHING
  RETURNING id, tenant_id, source_id
),
txns AS (
  SELECT it.id AS transaction_id, c.*
  FROM inserted it
  JOIN candidates c
    ON c.tenant_id = it.tenant_id
   AND c.invoice_id = it.source_id
)
INSERT INTO ledger_entries (
  tenant_id, transaction_id, account_code, debit_cents, credit_cents, memo
)
SELECT
  tenant_id,
  transaction_id,
  account_code,
  debit_cents,
  credit_cents,
  'Invoice ' || invoice_number
FROM txns
CROSS JOIN LATERAL (
  VALUES
    (receivable_account_code, total_cents, 0),
    (default_revenue_account_code, 0, net_cents),
    (output_vat_account_code, 0, tax_cents)
) AS line(account_code, debit_cents, credit_cents)
WHERE account_code IS NOT NULL
  AND (debit_cents > 0 OR credit_cents > 0);

-- Paid invoices: book cash receipt and clear receivable. Prefer Mollie's paid
-- timestamp; for older manually-paid invoices, updated_at (NOT NULL) is the
-- best available approximation of when the status changed.
WITH candidates AS (
  SELECT
    i.id AS invoice_id,
    i.tenant_id,
    i.invoice_number,
    COALESCE(i.mollie_paid_at::date, i.updated_at::date) AS paid_date,
    i.total_cents,
    tas.primary_checking_account_code,
    tas.receivable_account_code
  FROM invoices i
  JOIN tenant_accounting_settings tas ON tas.tenant_id = i.tenant_id
  WHERE i.status = 'paid'
    AND i.total_cents > 0
    AND tas.primary_checking_account_code IS NOT NULL
    AND tas.receivable_account_code IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM ledger_transactions sent
      WHERE sent.tenant_id = i.tenant_id
        AND sent.source_type = 'invoice'
        AND sent.source_id = i.id
        AND sent.source_event = 'sent'
    )
),
inserted AS (
  INSERT INTO ledger_transactions (
    tenant_id, entry_date, description, source_type, source_id, source_event, created_by_user_id
  )
  SELECT
    tenant_id,
    paid_date,
    'Invoice ' || invoice_number || ' paid',
    'invoice',
    invoice_id,
    'paid',
    NULL
  FROM candidates
  ON CONFLICT (tenant_id, source_type, source_id, source_event) DO NOTHING
  RETURNING id, tenant_id, source_id
),
txns AS (
  SELECT it.id AS transaction_id, c.*
  FROM inserted it
  JOIN candidates c
    ON c.tenant_id = it.tenant_id
   AND c.invoice_id = it.source_id
)
INSERT INTO ledger_entries (
  tenant_id, transaction_id, account_code, debit_cents, credit_cents, memo
)
SELECT
  tenant_id,
  transaction_id,
  account_code,
  debit_cents,
  credit_cents,
  'Invoice ' || invoice_number
FROM txns
CROSS JOIN LATERAL (
  VALUES
    (primary_checking_account_code, total_cents, 0),
    (receivable_account_code, 0, total_cents)
) AS line(account_code, debit_cents, credit_cents)
WHERE debit_cents > 0 OR credit_cents > 0;

-- Verification: every non-draft, non-void, non-zero invoice must now have its
-- journals, and every invoice journal must balance. Raising here rolls back
-- the whole file, so a failure leaves the ledger untouched and names the
-- offending invoices for manual repair before re-running the migration.
DO $$
DECLARE
  missing TEXT;
  unbalanced TEXT;
BEGIN
  SELECT string_agg(format('tenant %s invoice %s', i.tenant_id, i.invoice_number),
                    ', ' ORDER BY i.tenant_id, i.id)
    INTO missing
    FROM invoices i
   WHERE i.status IN ('sent', 'paid')
     AND i.total_cents > 0
     AND (
       NOT EXISTS (
         SELECT 1 FROM ledger_transactions lt
          WHERE lt.tenant_id = i.tenant_id AND lt.source_type = 'invoice'
            AND lt.source_id = i.id AND lt.source_event = 'sent'
       )
       OR (i.status = 'paid' AND NOT EXISTS (
         SELECT 1 FROM ledger_transactions lt
          WHERE lt.tenant_id = i.tenant_id AND lt.source_type = 'invoice'
            AND lt.source_id = i.id AND lt.source_event = 'paid'
       ))
     );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'invoice ledger backfill skipped invoices (inconsistent amounts or missing tenant account settings): %', missing;
  END IF;

  SELECT string_agg(format('transaction %s (%s)', b.id, b.description), ', ' ORDER BY b.id)
    INTO unbalanced
    FROM (
      SELECT lt.id, lt.description
        FROM ledger_transactions lt
        JOIN ledger_entries le ON le.transaction_id = lt.id
       WHERE lt.source_type = 'invoice'
       GROUP BY lt.id, lt.description
      HAVING SUM(le.debit_cents) <> SUM(le.credit_cents)
    ) b;

  IF unbalanced IS NOT NULL THEN
    RAISE EXCEPTION 'invoice ledger backfill produced unbalanced journals: %', unbalanced;
  END IF;
END $$;
