-- PayPal payouts can be recorded directly on the primary bank account while
-- retaining the existing bank-statement reconciliation path.

ALTER TABLE paypal_payout_reconciliations
  ALTER COLUMN bank_statement_line_id DROP NOT NULL,
  ADD COLUMN reference TEXT,
  ADD COLUMN settlement_method TEXT
    CHECK (settlement_method IN ('bank_import', 'manual')),
  ADD COLUMN settlement_entry_date DATE,
  ADD COLUMN settled_at TIMESTAMPTZ,
  ADD COLUMN settled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE paypal_payout_reconciliations ppr
   SET settlement_method = 'bank_import',
       settlement_entry_date = bsl.booking_date,
       settled_at = ppr.created_at,
       settled_by_user_id = ppr.created_by_user_id
  FROM bank_statement_lines bsl
 WHERE bsl.id = ppr.bank_statement_line_id
   AND bsl.tenant_id = ppr.tenant_id
   AND ppr.ledger_transaction_id IS NOT NULL;

ALTER TABLE paypal_payout_reconciliations
  ADD CONSTRAINT paypal_reconciliation_reference_length
    CHECK (reference IS NULL OR char_length(reference) BETWEEN 1 AND 120),
  ADD CONSTRAINT paypal_reconciliation_settlement_state CHECK (
    (ledger_transaction_id IS NULL AND settlement_method IS NULL
      AND settlement_entry_date IS NULL AND settled_at IS NULL)
    OR
    (ledger_transaction_id IS NOT NULL AND settlement_method IS NOT NULL
      AND settlement_entry_date IS NOT NULL AND settled_at IS NOT NULL
      AND (
        (settlement_method = 'bank_import' AND bank_statement_line_id IS NOT NULL)
        OR
        (settlement_method = 'manual' AND bank_statement_line_id IS NULL
          AND reference IS NOT NULL)
      ))
  );
