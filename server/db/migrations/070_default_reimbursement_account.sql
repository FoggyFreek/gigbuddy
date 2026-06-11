-- Default reimbursement liability account for amounts owed to band members.

INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, '22000', 'Due to Band Members', 'liability', '20000', true
FROM tenants t
WHERE EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = '20000'
)
ON CONFLICT (tenant_id, code) DO NOTHING;

ALTER TABLE tenant_accounting_settings
  ADD COLUMN IF NOT EXISTS default_reimbursement_account_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tas_default_reimbursement_fk'
  ) THEN
    ALTER TABLE tenant_accounting_settings
      ADD CONSTRAINT tas_default_reimbursement_fk
      FOREIGN KEY (tenant_id, default_reimbursement_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
END $$;

UPDATE tenant_accounting_settings tas
   SET default_reimbursement_account_code = '22000'
 WHERE default_reimbursement_account_code IS NULL
   AND EXISTS (
     SELECT 1 FROM chart_of_accounts c
      WHERE c.tenant_id = tas.tenant_id
        AND c.code = '22000'
   );
