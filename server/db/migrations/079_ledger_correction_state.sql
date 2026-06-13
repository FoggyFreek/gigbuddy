-- Manual ledger correction state (feature-ledger).
-- A wrongly-entered ledger transaction is corrected in one of two ways,
-- depending on whether its booking period is open or closed:
--
--  * VOID (open period): the original and its reversing transaction both take
--    the "voided" state — hidden from the ledger by default and excluded from
--    every financial calculation/report, but retained for the audit trail.
--  * REVERSAL (closed period): a *visible* correction. A reversing transaction
--    is posted in the open period; both rows stay visible and included in
--    financials, so the closed period is never mutated.
--
-- The correcting transaction itself is identified by its existing
-- (source_type='ledger_transaction', source_id=<original id>,
-- source_event IN ('void','reversal')); only the original needs these markers.
ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS voided_at                  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by_transaction_id   INTEGER,
  ADD COLUMN IF NOT EXISTS reversed_by_transaction_id INTEGER;

-- Tenant-safe self-references (mirror the UNIQUE (id, tenant_id) backstop so a
-- marker can never point at another tenant's transaction).
ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_txn_voided_by_fk
    FOREIGN KEY (voided_by_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id),
  ADD CONSTRAINT ledger_txn_reversed_by_fk
    FOREIGN KEY (reversed_by_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id);

-- Keeps the financial-exclusion filter (voided_at IS NULL) cheap.
CREATE INDEX IF NOT EXISTS idx_ledger_txn_voided
  ON ledger_transactions(tenant_id) WHERE voided_at IS NOT NULL;

-- Backfill existing manual voids (no reversals exist yet): mark each original
-- that already has a ledger_transaction/void reversing it.
UPDATE ledger_transactions orig
   SET voided_at = rev.created_at,
       voided_by_transaction_id = rev.id
  FROM ledger_transactions rev
 WHERE rev.source_type = 'ledger_transaction'
   AND rev.source_event = 'void'
   AND rev.source_id = orig.id
   AND rev.tenant_id = orig.tenant_id
   AND orig.voided_at IS NULL;
