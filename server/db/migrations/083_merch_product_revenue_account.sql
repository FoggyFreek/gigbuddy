-- Per-product merchandise revenue account.
--
-- Merch revenue used to post entirely to the tenant-wide
-- merch_revenue_account_code (e.g. 42000 Merchandise Sales). Bands now want to
-- split revenue per product (CDs → 42100, shirts → another sub-account) for
-- finer reporting.
--
-- A product may carry its own revenue_account_code (the band's merch revenue
-- parent itself, or a hierarchical descendant of it — enforced in the service).
-- Each sale snapshots the resolved code at sale time, just like unit_cost_cents,
-- so a later void reverses to the exact same account even if the product's
-- account is changed afterward. Both columns are nullable; NULL falls back to
-- the tenant's merch_revenue_account_code, so existing rows are unchanged.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS revenue_account_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_revenue_account_fk') THEN
    ALTER TABLE products
      ADD CONSTRAINT products_revenue_account_fk
      FOREIGN KEY (tenant_id, revenue_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
END $$;

ALTER TABLE merch_sales
  ADD COLUMN IF NOT EXISTS revenue_account_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merch_sales_revenue_account_fk') THEN
    ALTER TABLE merch_sales
      ADD CONSTRAINT merch_sales_revenue_account_fk
      FOREIGN KEY (tenant_id, revenue_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
END $$;
