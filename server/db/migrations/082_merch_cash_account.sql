-- Merch sales: choose where the receipt lands (bank vs cash on hand).
--
-- A merch sale's cash/debit leg used to be hardcoded to the primary checking
-- account. Now each sale carries a payment_method ('bank' | 'cash') and the
-- ledger posting resolves it to either primary_checking_account_code or the new
-- cash_account_code tenant setting. Defaults to 'bank', so existing behavior is
-- unchanged unless a sale opts into cash.
--
-- Mirrors server/db/defaultChartOfAccounts.js (the JS seed for new tenants) —
-- keep both in sync.

-- Existing tenants: add a "Cash on hand" asset account (parent 10000 already
-- exists from migration 064). Not a capitalizable purchase target.
INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, '11100', 'Cash on hand', 'asset', '10000', true
FROM tenants t
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Tenant default cash account for merch postings (mirrors 077).
ALTER TABLE tenant_accounting_settings
  ADD COLUMN IF NOT EXISTS cash_account_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tas_cash_account_fk') THEN
    ALTER TABLE tenant_accounting_settings
      ADD CONSTRAINT tas_cash_account_fk
      FOREIGN KEY (tenant_id, cash_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
END $$;

-- Backfill only when the tenant's 11100 is an asset account: a tenant may have a
-- pre-existing custom 11100 of another type, which must not become the cash
-- target. Those tenants keep cash_account_code NULL and set it in Settings.
UPDATE tenant_accounting_settings tas
   SET cash_account_code = '11100'
 WHERE cash_account_code IS NULL
   AND EXISTS (
     SELECT 1 FROM chart_of_accounts c
      WHERE c.tenant_id = tas.tenant_id AND c.code = '11100' AND c.type = 'asset'
   );

-- Per-sale destination for the cash receipt. Existing rows default to 'bank'
-- (they all booked to checking), so history is preserved.
ALTER TABLE merch_sales
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'bank'
    CHECK (payment_method IN ('bank', 'cash'));
