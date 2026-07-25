-- Migration 125 dropped the NL-only enumerated CHECKs (21/9/0) from the merch
-- tables so foreign VAT rates (e.g. German 19%) could be stored. That left the
-- vat_rate columns with NO database bound at all: a stray import or bad code
-- path could persist a negative or absurd (>100%) rate that the service layer
-- would otherwise reject. Restore a permissive sanity bound — a percentage is
-- always in [0, 100] — while keeping the exact per-country allowed set enforced
-- in the service against shared/vatRates.js (that set is country-dependent and
-- cannot live in a static CHECK). The products table is named `products`.
-- DROP-then-ADD: PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, and this file
-- must stay re-runnable (it was renumbered, so a database that applied the
-- earlier number would otherwise fail on a duplicate constraint).
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_vat_rate_range;
ALTER TABLE products
  ADD CONSTRAINT products_vat_rate_range
  CHECK (vat_rate >= 0 AND vat_rate <= 100);

ALTER TABLE merch_sales DROP CONSTRAINT IF EXISTS merch_sales_vat_rate_range;
ALTER TABLE merch_sales
  ADD CONSTRAINT merch_sales_vat_rate_range
  CHECK (vat_rate >= 0 AND vat_rate <= 100);
