-- Contract step: tenant_accounting_profiles owns the accounting regime; these
-- columns are unread copies of it.
--
-- Must be its own deployment: deploy.yml migrates while the old app container
-- still serves.
--
-- Preflight for the NOT NULL below. Repair first with:
--   infisical run -- node server/scripts/backfillAccountingProfiles.js --check
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant_accounting_profiles WHERE default_vat_rate IS NULL) THEN
    RAISE EXCEPTION
      'accounting profile contract preflight failed: profiles with a NULL default_vat_rate remain; run backfillAccountingProfiles.js --apply first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tenants t
     LEFT JOIN tenant_accounting_profiles p ON p.tenant_id = t.id
     WHERE p.tenant_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'accounting profile contract preflight failed: tenants without an accounting profile remain; repair them with backfillAccountingProfiles.js --apply --tenant=<id> --country=<cc> first';
  END IF;
END $$;

ALTER TABLE tenant_accounting_profiles
  ALTER COLUMN default_vat_rate SET NOT NULL;

-- tap_country_code_supported on the profile carries the supported-country list.
ALTER TABLE tenants DROP COLUMN IF EXISTS vat_country;

-- `directors` stays: it is a contact fact, not regime, and the invoice PDF still
-- discloses it for an incorporated legal form.
ALTER TABLE tenants DROP COLUMN IF EXISTS legal_form;

ALTER TABLE tenants DROP COLUMN IF EXISTS tax_percentage;

-- Scheme participation is effective-dated in tax_scheme_enrolments.
ALTER TABLE tenants DROP COLUMN IF EXISTS applies_kor;

-- Derived from tenant_accounting_profiles.base_currency in accountService.
ALTER TABLE tenant_accounting_settings DROP COLUMN IF EXISTS currency;
