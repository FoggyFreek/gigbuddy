-- Tracks which Shopify order *lines* have been imported into merch, so a
-- re-import is a no-op (line-level idempotency) and the orders list can show a
-- line as already imported. One row per imported line:
--   kind='product' → fills merch_sale_id (a real merch_sales row, inventory + COGS)
--   kind='revenue' → fills ledger_transaction_id (a revenue-only journal); the
--                     row's own id is also the ledger source_id for that journal.
-- Shopify ids are bigints beyond INTEGER range, so they are stored as TEXT.
CREATE TABLE shopify_order_imports (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shopify_order_id TEXT NOT NULL,
  shopify_line_id  TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('product', 'revenue')),
  merch_sale_id INTEGER,
  ledger_transaction_id INTEGER,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, shopify_line_id),
  -- Tenant-safe composite FKs (both parents carry UNIQUE(id, tenant_id)) so the
  -- DB backstops a cross-tenant link even if a write forgets its scope. Nullable:
  -- a product line fills merch_sale_id, a revenue line fills ledger_transaction_id.
  CONSTRAINT shopify_order_imports_merch_sale_fkey
    FOREIGN KEY (merch_sale_id, tenant_id) REFERENCES merch_sales(id, tenant_id),
  CONSTRAINT shopify_order_imports_ledger_txn_fkey
    FOREIGN KEY (ledger_transaction_id, tenant_id) REFERENCES ledger_transactions(id, tenant_id)
);

CREATE INDEX shopify_order_imports_tenant_order_idx
  ON shopify_order_imports (tenant_id, shopify_order_id);
