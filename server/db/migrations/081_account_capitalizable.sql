-- Capitalizing fixed-asset purchases.
--
-- A purchase line may now book to an asset account (capitalizing owned gear onto
-- the balance sheet) instead of straight to expense. To keep the picker safe,
-- only asset accounts explicitly flagged `is_capitalizable` are offered — not the
-- bank, VAT, receivable or inventory accounts. Depreciation itself stays a manual
-- journal (DR Depreciation Expense / CR Accumulated Depreciation).
--
-- Mirrors server/db/defaultChartOfAccounts.js (the JS seed for new tenants) —
-- keep both in sync.

ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS is_capitalizable BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing tenants: the seeded "Owned Gear" and "Band Van or Vehicle" asset
-- accounts become bookable targets for capitalized purchases.
UPDATE chart_of_accounts
   SET is_capitalizable = TRUE, updated_at = NOW()
 WHERE type = 'asset' AND code IN ('13000', '14000') AND is_capitalizable = FALSE;

-- Depreciation accounts for existing tenants (parents 13000/62000 already exist
-- from migration 064). These are never purchase targets, so they stay
-- non-capitalizable.
INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, v.code, v.name, v.type::text, v.parent_code, true
FROM tenants t
CROSS JOIN (VALUES
  ('13100', 'Accumulated Depreciation - Gear', 'asset',   '13000'),
  ('62900', 'Depreciation Expense',            'expense', '62000')
) AS v(code, name, type, parent_code)
ON CONFLICT (tenant_id, code) DO NOTHING;
