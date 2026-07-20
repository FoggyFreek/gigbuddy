-- VAT tariffs are country-dependent. Give each tenant a VAT country (the tax
-- jurisdiction its default VAT percentage and selectable rates come from). This
-- is distinct from the free-text postal `address_country`: it is a normalized
-- ISO 3166-1 alpha-2 code (lowercase) matched against shared/vatRates.js.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vat_country TEXT NOT NULL DEFAULT 'nl'
  CHECK (vat_country ~ '^[a-z]{2}$');

-- The set of allowed VAT rates now depends on the tenant's country and is
-- enforced in the service layer against shared/vatRates.js, so the NL-only
-- CHECK constraints baked into the merch tables (021.00 / 9.00 / 0.00) must go —
-- a German product at 19% would otherwise be rejected (was CHECK IN 21/9/0).
ALTER TABLE merch_products DROP CONSTRAINT IF EXISTS merch_products_vat_rate_check;
ALTER TABLE merch_sales DROP CONSTRAINT IF EXISTS merch_sales_vat_rate_check;
