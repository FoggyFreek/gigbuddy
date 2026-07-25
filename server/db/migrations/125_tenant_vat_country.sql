-- VAT tariffs are country-dependent. Give each tenant a VAT country (the tax
-- jurisdiction its default VAT percentage and selectable rates come from). This
-- is distinct from the free-text postal `address_country`: it is a normalized
-- ISO 3166-1 alpha-2 code (lowercase) matched against shared/vatRates.js.
--
-- The CHECK enumerates the SUPPORTED codes rather than any two-letter string:
-- unknown countries have no rate table, so the app silently falls back to the
-- Dutch 21/9/0 rates. Rejecting them at the database keeps a value that bypasses
-- the profile validator (raw SQL, imports, a future code path) from producing a
-- tenant whose stored jurisdiction disagrees with the rates actually applied.
-- This list mirrors VAT_COUNTRIES in shared/vatRates.js; adding a country there
-- requires a follow-up migration to extend this constraint.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vat_country TEXT NOT NULL DEFAULT 'nl'
  CONSTRAINT tenants_vat_country_supported
  CHECK (vat_country IN ('nl', 'be', 'de', 'fr', 'lu', 'at', 'es', 'it', 'ie', 'gb'));

-- The set of allowed VAT rates now depends on the tenant's country and is
-- enforced in the service layer against shared/vatRates.js, so the NL-only
-- CHECK constraints baked into the merch tables (021.00 / 9.00 / 0.00) must go —
-- a German product at 19% would otherwise be rejected (was CHECK IN 21/9/0).
-- The products table is named `products` (not `merch_products`); its inline
-- unnamed CHECK is auto-named `products_vat_rate_check`.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_vat_rate_check;
ALTER TABLE merch_sales DROP CONSTRAINT IF EXISTS merch_sales_vat_rate_check;
