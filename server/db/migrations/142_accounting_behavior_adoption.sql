-- Adopt the accounting profile as the behavioral owner of currency and the
-- default VAT rate. This remains additive for the expand/contract deployment.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE currency <> 'EUR')
     OR EXISTS (SELECT 1 FROM purchases WHERE currency <> 'EUR')
     OR EXISTS (
       SELECT 1 FROM bank_statement_imports
        WHERE currency IS NOT NULL AND currency <> 'EUR'
     ) THEN
    RAISE EXCEPTION
      'accounting behavior preflight failed: historical financial documents must be EUR';
  END IF;
END $$;

ALTER TABLE tenant_accounting_profiles
  ADD COLUMN IF NOT EXISTS default_vat_rate NUMERIC(5, 2);

-- Preserve the stored decimal value exactly during the compatibility window.
UPDATE tenant_accounting_profiles p
   SET default_vat_rate = t.tax_percentage
  FROM tenants t
 WHERE t.id = p.tenant_id
   AND p.default_vat_rate IS NULL;

-- Compatibility projection retained until the settings currency column is
-- removed in Step 4.
--
-- Clamped to EUR (shared/accountingProfileCodes.js: BOOKKEEPING_CURRENCIES).
-- base_currency stays truthful, but this column is behavioral: copying GBP here
-- while every existing document is EUR — which the preflight guarantees — would
-- mix two units in a ledger that has no currency column.
UPDATE tenant_accounting_settings s
   SET currency = CASE WHEN p.base_currency IN ('EUR') THEN p.base_currency ELSE 'EUR' END,
       updated_at = NOW()
  FROM tenant_accounting_profiles p
 WHERE p.tenant_id = s.tenant_id
   AND s.currency IS DISTINCT FROM
       CASE WHEN p.base_currency IN ('EUR') THEN p.base_currency ELSE 'EUR' END;

-- VAT return quarters and invoice-number years intentionally remain calendar
-- periods. A reporting fiscal year never changes a filing quarter or sequence.
