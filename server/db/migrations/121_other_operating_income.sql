-- Other operating income accounts for every existing tenant.
-- Mirrors server/db/defaultChartOfAccounts.js (the JS seed for new tenants) —
-- keep both in sync.

-- Parent must be inserted first because the parent foreign key is immediate.
INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, '70000', 'Other Operating Income', 'revenue', NULL, true
  FROM tenants t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, '71000', 'Grants & Subsidies', 'revenue', '70000', true
  FROM tenants t
 WHERE EXISTS (
   SELECT 1
     FROM chart_of_accounts parent
    WHERE parent.tenant_id = t.id
      AND parent.code = '70000'
      AND parent.type = 'revenue'
 )
ON CONFLICT (tenant_id, code) DO NOTHING;
