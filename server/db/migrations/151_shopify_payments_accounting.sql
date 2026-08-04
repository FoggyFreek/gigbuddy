-- Shopify Payments clearing, fee capture, payout reconciliation, and
-- immutable post-import adjustments.

INSERT INTO chart_of_accounts (
  tenant_id, code, name, type, parent_code, is_system, reporting_group
)
SELECT t.id, v.code, v.name, v.type, v.parent_code, true, v.reporting_group
FROM tenants t
CROSS JOIN (VALUES
  ('11300', 'Shopify Payments Clearing', 'asset',   '11000', NULL),
  ('64100', 'Payment Processing Fees',   'expense', '64000', 'operating_expense')
) AS v(code, name, type, parent_code, reporting_group)
ON CONFLICT (tenant_id, code) DO NOTHING;

ALTER TABLE tenant_accounting_settings
  ADD COLUMN shopify_clearing_account_code TEXT,
  ADD COLUMN shopify_fee_expense_account_code TEXT;

ALTER TABLE tenant_accounting_settings
  ADD CONSTRAINT tas_shopify_clearing_fk
    FOREIGN KEY (tenant_id, shopify_clearing_account_code)
    REFERENCES chart_of_accounts(tenant_id, code),
  ADD CONSTRAINT tas_shopify_fee_expense_fk
    FOREIGN KEY (tenant_id, shopify_fee_expense_account_code)
    REFERENCES chart_of_accounts(tenant_id, code);

UPDATE tenant_accounting_settings tas
   SET shopify_clearing_account_code = '11300'
 WHERE shopify_clearing_account_code IS NULL
   AND EXISTS (
     SELECT 1 FROM chart_of_accounts coa
      WHERE coa.tenant_id = tas.tenant_id AND coa.code = '11300' AND coa.type = 'asset'
   );

UPDATE tenant_accounting_settings tas
   SET shopify_fee_expense_account_code = '64100'
 WHERE shopify_fee_expense_account_code IS NULL
   AND EXISTS (
     SELECT 1 FROM chart_of_accounts coa
      WHERE coa.tenant_id = tas.tenant_id AND coa.code = '64100' AND coa.type = 'expense'
   );

CREATE TABLE shopify_order_financials (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shopify_order_gid TEXT NOT NULL,
  shopify_order_legacy_id TEXT NOT NULL,
  order_name TEXT NOT NULL,
  currency TEXT NOT NULL,
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  fee_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  imported_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, shopify_order_gid),
  UNIQUE (tenant_id, shopify_order_legacy_id)
);

ALTER TABLE shopify_order_imports
  ADD COLUMN shopify_order_financial_id INTEGER,
  ADD CONSTRAINT shopify_order_imports_financial_fkey
    FOREIGN KEY (shopify_order_financial_id, tenant_id)
    REFERENCES shopify_order_financials(id, tenant_id);

CREATE TABLE shopify_order_components (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_financial_id INTEGER NOT NULL,
  component_key TEXT NOT NULL,
  component_kind TEXT NOT NULL CHECK (component_kind IN (
    'line', 'shipping', 'tip', 'duty', 'additional_fee', 'other'
  )),
  title TEXT NOT NULL,
  shopify_line_gid TEXT,
  shopify_line_legacy_id TEXT,
  mapping_kind TEXT NOT NULL CHECK (mapping_kind IN ('product', 'revenue')),
  product_id INTEGER,
  revenue_account_code TEXT,
  vat_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  tax_category_code TEXT,
  tax_jurisdiction_code TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  net_revenue_cents INTEGER NOT NULL CHECK (net_revenue_cents >= 0),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  merch_sale_id INTEGER,
  ledger_transaction_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, order_financial_id, component_key),
  CONSTRAINT shopify_order_components_order_fkey
    FOREIGN KEY (order_financial_id, tenant_id)
    REFERENCES shopify_order_financials(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT shopify_order_components_product_fkey
    FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id),
  CONSTRAINT shopify_order_components_revenue_fkey
    FOREIGN KEY (tenant_id, revenue_account_code)
    REFERENCES chart_of_accounts(tenant_id, code),
  CONSTRAINT shopify_order_components_sale_fkey
    FOREIGN KEY (merch_sale_id, tenant_id) REFERENCES merch_sales(id, tenant_id),
  CONSTRAINT shopify_order_components_ledger_fkey
    FOREIGN KEY (ledger_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id)
);

CREATE TABLE shopify_payments_payouts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shopify_payout_gid TEXT NOT NULL,
  shopify_payout_legacy_id TEXT NOT NULL,
  status TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('DEPOSIT', 'WITHDRAWAL')),
  currency TEXT NOT NULL,
  net_cents INTEGER NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  external_trace_id TEXT,
  sync_complete BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconciled_bank_statement_line_id INTEGER,
  ledger_transaction_id INTEGER,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, shopify_payout_gid),
  UNIQUE (tenant_id, shopify_payout_legacy_id),
  UNIQUE (tenant_id, reconciled_bank_statement_line_id),
  CONSTRAINT shopify_payout_bank_line_fkey
    FOREIGN KEY (reconciled_bank_statement_line_id, tenant_id)
    REFERENCES bank_statement_lines(id, tenant_id),
  CONSTRAINT shopify_payout_ledger_fkey
    FOREIGN KEY (ledger_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id)
);

CREATE TABLE shopify_payments_balance_transactions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shopify_balance_transaction_gid TEXT NOT NULL,
  order_financial_id INTEGER,
  associated_order_gid TEXT,
  source_order_transaction_id TEXT,
  shopify_payout_gid TEXT,
  payout_id INTEGER,
  source_type TEXT,
  transaction_type TEXT NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,
  currency TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'recorded', 'needs_review', 'blocked')),
  mapped_account_code TEXT,
  ledger_transaction_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, shopify_balance_transaction_gid),
  CONSTRAINT shopify_balance_order_fkey
    FOREIGN KEY (order_financial_id, tenant_id)
    REFERENCES shopify_order_financials(id, tenant_id),
  CONSTRAINT shopify_balance_payout_fkey
    FOREIGN KEY (payout_id, tenant_id)
    REFERENCES shopify_payments_payouts(id, tenant_id),
  CONSTRAINT shopify_balance_account_fkey
    FOREIGN KEY (tenant_id, mapped_account_code)
    REFERENCES chart_of_accounts(tenant_id, code),
  CONSTRAINT shopify_balance_ledger_fkey
    FOREIGN KEY (ledger_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id)
);

CREATE INDEX shopify_balance_order_idx
  ON shopify_payments_balance_transactions (tenant_id, associated_order_gid);
CREATE INDEX shopify_balance_payout_idx
  ON shopify_payments_balance_transactions (tenant_id, shopify_payout_gid);

CREATE TABLE shopify_order_component_adjustments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL,
  balance_transaction_id INTEGER NOT NULL,
  shopify_refund_gid TEXT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  net_revenue_cents INTEGER NOT NULL CHECK (net_revenue_cents >= 0),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  restocked BOOLEAN NOT NULL DEFAULT FALSE,
  ledger_transaction_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, component_id, balance_transaction_id),
  CONSTRAINT shopify_component_adjustment_component_fkey
    FOREIGN KEY (component_id, tenant_id)
    REFERENCES shopify_order_components(id, tenant_id),
  CONSTRAINT shopify_component_adjustment_balance_fkey
    FOREIGN KEY (balance_transaction_id, tenant_id)
    REFERENCES shopify_payments_balance_transactions(id, tenant_id),
  CONSTRAINT shopify_component_adjustment_ledger_fkey
    FOREIGN KEY (ledger_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id)
);

ALTER TABLE bank_statement_lines
  DROP CONSTRAINT bank_statement_lines_status_check,
  ADD CONSTRAINT bank_statement_lines_status_check CHECK (status IN (
    'pending', 'imported', 'skipped',
    'reconciled_invoice', 'reconciled_purchase', 'reconciled_shopify_payout',
    'skipped_currency', 'skipped_closed_period',
    'skipped_accounting_not_configured', 'skipped_error'
  ));

ALTER TABLE bank_statement_lines
  DROP CONSTRAINT bank_statement_lines_matched_source_type_check,
  ADD CONSTRAINT bank_statement_lines_matched_source_type_check
    CHECK (matched_source_type IN ('invoice', 'purchase', 'shopify_payout'));
