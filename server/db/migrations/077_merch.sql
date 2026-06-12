-- Merchandise: products with stock on hand, sales that post revenue + COGS,
-- and purchase lines that stock products on approval.

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Fixed unit cost used as the COGS basis on every sale (user decision: no
  -- moving average). Sales snapshot this value so later edits don't rewrite
  -- history.
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  default_price_incl_cents INTEGER NOT NULL DEFAULT 0 CHECK (default_price_incl_cents >= 0),
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 21.00 CHECK (vat_rate IN (21.00, 9.00, 0.00)),
  quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_id_tenant_id_key UNIQUE (id, tenant_id)
);

CREATE INDEX products_tenant_name_idx ON products(tenant_id, name);

-- A purchase line may stock a product: on approval the line's quantity is
-- added to quantity_on_hand and its net books to the merch inventory account
-- instead of an expense account.
ALTER TABLE purchase_lines
  ADD COLUMN product_id INTEGER,
  ADD COLUMN quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  ADD CONSTRAINT purchase_lines_product_id_tenant_id_fkey
    FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id);

CREATE TABLE merch_sales (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  gig_id INTEGER,
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_incl_cents INTEGER NOT NULL CHECK (unit_price_incl_cents >= 0),
  vat_rate NUMERIC(5, 2) NOT NULL CHECK (vat_rate IN (21.00, 9.00, 0.00)),
  -- Snapshot of products.unit_cost_cents at sale time: the COGS basis, and
  -- what a void reverses even if the product is edited later.
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'voided')),
  voided_at TIMESTAMPTZ,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT merch_sales_id_tenant_id_key UNIQUE (id, tenant_id),
  CONSTRAINT merch_sales_product_id_tenant_id_fkey
    FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id),
  -- Composite FK with explicit column list on SET NULL: only gig_id is
  -- nullified, tenant_id stays (it is NOT NULL). Mirrors purchases (063).
  CONSTRAINT merch_sales_gig_id_tenant_id_fkey
    FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs(id, tenant_id)
    ON DELETE SET NULL (gig_id)
);

CREATE INDEX merch_sales_tenant_date_idx ON merch_sales(tenant_id, sale_date DESC);
CREATE INDEX merch_sales_product_idx ON merch_sales(product_id);

-- Tenant default accounts for merch postings (mirrors 070).
ALTER TABLE tenant_accounting_settings
  ADD COLUMN IF NOT EXISTS merch_inventory_account_code TEXT,
  ADD COLUMN IF NOT EXISTS merch_revenue_account_code TEXT,
  ADD COLUMN IF NOT EXISTS merch_cogs_account_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tas_merch_inventory_fk') THEN
    ALTER TABLE tenant_accounting_settings
      ADD CONSTRAINT tas_merch_inventory_fk
      FOREIGN KEY (tenant_id, merch_inventory_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tas_merch_revenue_fk') THEN
    ALTER TABLE tenant_accounting_settings
      ADD CONSTRAINT tas_merch_revenue_fk
      FOREIGN KEY (tenant_id, merch_revenue_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tas_merch_cogs_fk') THEN
    ALTER TABLE tenant_accounting_settings
      ADD CONSTRAINT tas_merch_cogs_fk
      FOREIGN KEY (tenant_id, merch_cogs_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
END $$;

UPDATE tenant_accounting_settings tas
   SET merch_inventory_account_code = '12200'
 WHERE merch_inventory_account_code IS NULL
   AND EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = tas.tenant_id AND c.code = '12200');

UPDATE tenant_accounting_settings tas
   SET merch_revenue_account_code = '42000'
 WHERE merch_revenue_account_code IS NULL
   AND EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = tas.tenant_id AND c.code = '42000');

UPDATE tenant_accounting_settings tas
   SET merch_cogs_account_code = '51000'
 WHERE merch_cogs_account_code IS NULL
   AND EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = tas.tenant_id AND c.code = '51000');
