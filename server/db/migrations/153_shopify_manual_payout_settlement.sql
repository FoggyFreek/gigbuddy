-- A Shopify payout may be settled either by matching a staged bank statement
-- line or by explicitly recording it on the configured primary bank account.

ALTER TABLE shopify_payments_payouts
  ADD COLUMN settlement_method TEXT
    CHECK (settlement_method IN ('bank_import', 'manual')),
  ADD COLUMN settlement_entry_date DATE,
  ADD COLUMN settled_at TIMESTAMPTZ,
  ADD COLUMN settled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE shopify_payments_payouts spp
   SET settlement_method = 'bank_import',
       settlement_entry_date = bsl.booking_date,
       settled_at = NOW()
  FROM bank_statement_lines bsl
 WHERE bsl.id = spp.reconciled_bank_statement_line_id
   AND bsl.tenant_id = spp.tenant_id
   AND spp.ledger_transaction_id IS NOT NULL;

ALTER TABLE shopify_payments_payouts
  ADD CONSTRAINT shopify_payout_settlement_state_check CHECK (
    (ledger_transaction_id IS NULL AND settlement_method IS NULL
      AND settlement_entry_date IS NULL AND settled_at IS NULL)
    OR
    (ledger_transaction_id IS NOT NULL AND settlement_method IS NOT NULL
      AND settlement_entry_date IS NOT NULL AND settled_at IS NOT NULL)
  );
