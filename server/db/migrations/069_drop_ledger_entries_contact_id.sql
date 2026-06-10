-- Purchases already own supplier_contact_id; ledger entries should not duplicate
-- the purchase counterparty on every posting line.
ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_contact_fkey,
  DROP COLUMN IF EXISTS contact_id;
