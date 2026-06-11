-- Reimbursements: settle what the band owes members who fronted cash for purchases.
-- A reimbursement claims one or more member-paid purchases (whole rows) and posts
-- DR <reimbursement liability> / CR <primary checking> for their summed amount.
-- INTEGER ids match the rest of the financial schema (purchases, ledger source ids).

CREATE TABLE IF NOT EXISTS reimbursements (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  band_member_id INTEGER NOT NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),  -- snapshot = sum of settled purchases
  paid_on        DATE    NOT NULL,
  memo           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),                                    -- for composite child FKs
  FOREIGN KEY (band_member_id, tenant_id) REFERENCES band_members(id, tenant_id)
);

CREATE INDEX IF NOT EXISTS reimbursements_tenant_member_idx
  ON reimbursements (tenant_id, band_member_id);

-- Link the purchases a reimbursement settled (one reimbursement -> many purchases).
-- A purchase is outstanding while payment_method='member', status='paid', reimbursement_id IS NULL.
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS reimbursement_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchases_reimbursement_id_tenant_id_fkey'
  ) THEN
    ALTER TABLE purchases
      ADD CONSTRAINT purchases_reimbursement_id_tenant_id_fkey
      FOREIGN KEY (reimbursement_id, tenant_id)
      REFERENCES reimbursements(id, tenant_id)
      ON DELETE SET NULL (reimbursement_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS purchases_reimbursement_idx
  ON purchases (tenant_id, reimbursement_id);
