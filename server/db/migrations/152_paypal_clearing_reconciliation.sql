-- PayPal orders are visible in Shopify, but their processor fees and payouts
-- are not Shopify Payments balance transactions. Record their gross revenue in
-- a separate clearing account and reconcile grouped orders against the actual
-- PayPal bank deposit.

INSERT INTO chart_of_accounts (
  tenant_id, code, name, type, parent_code, is_system, reporting_group
)
SELECT t.id, '11400', 'PayPal Clearing', 'asset', '11000', true, NULL
  FROM tenants t
ON CONFLICT (tenant_id, code) DO NOTHING;

ALTER TABLE tenant_accounting_settings
  ADD COLUMN paypal_clearing_account_code TEXT,
  ADD CONSTRAINT tas_paypal_clearing_fk
    FOREIGN KEY (tenant_id, paypal_clearing_account_code)
    REFERENCES chart_of_accounts(tenant_id, code);

UPDATE tenant_accounting_settings tas
   SET paypal_clearing_account_code = '11400'
 WHERE paypal_clearing_account_code IS NULL
   AND EXISTS (
     SELECT 1 FROM chart_of_accounts coa
      WHERE coa.tenant_id = tas.tenant_id AND coa.code = '11400' AND coa.type = 'asset'
   );

ALTER TABLE shopify_order_financials
  ADD COLUMN payment_gateway TEXT NOT NULL DEFAULT 'shopify_payments',
  ADD COLUMN processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ALTER COLUMN fee_cents DROP NOT NULL,
  ALTER COLUMN net_cents DROP NOT NULL,
  ADD CONSTRAINT shopify_order_financials_gateway_check
    CHECK (payment_gateway IN ('shopify_payments', 'paypal'));

CREATE TABLE paypal_payout_reconciliations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_statement_line_id INTEGER NOT NULL,
  currency TEXT NOT NULL,
  gross_cents INTEGER NOT NULL CHECK (gross_cents > 0),
  deposit_cents INTEGER NOT NULL CHECK (deposit_cents > 0),
  difference_cents INTEGER NOT NULL,
  difference_account_code TEXT,
  ledger_transaction_id INTEGER,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, bank_statement_line_id),
  CONSTRAINT paypal_reconciliation_bank_line_fkey
    FOREIGN KEY (bank_statement_line_id, tenant_id)
    REFERENCES bank_statement_lines(id, tenant_id),
  CONSTRAINT paypal_reconciliation_difference_account_fkey
    FOREIGN KEY (tenant_id, difference_account_code)
    REFERENCES chart_of_accounts(tenant_id, code),
  CONSTRAINT paypal_reconciliation_ledger_fkey
    FOREIGN KEY (ledger_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id),
  CONSTRAINT paypal_reconciliation_difference_account_required
    CHECK (difference_cents = 0 OR difference_account_code IS NOT NULL)
);

CREATE TABLE paypal_payout_reconciliation_orders (
  reconciliation_id INTEGER NOT NULL,
  order_financial_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (reconciliation_id, order_financial_id),
  UNIQUE (tenant_id, order_financial_id),
  CONSTRAINT paypal_reconciliation_orders_reconciliation_fkey
    FOREIGN KEY (reconciliation_id, tenant_id)
    REFERENCES paypal_payout_reconciliations(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT paypal_reconciliation_orders_order_fkey
    FOREIGN KEY (order_financial_id, tenant_id)
    REFERENCES shopify_order_financials(id, tenant_id)
);

ALTER TABLE bank_statement_lines
  DROP CONSTRAINT bank_statement_lines_status_check,
  ADD CONSTRAINT bank_statement_lines_status_check CHECK (status IN (
    'pending', 'imported', 'skipped',
    'reconciled_invoice', 'reconciled_purchase', 'reconciled_shopify_payout',
    'reconciled_paypal_payout',
    'skipped_currency', 'skipped_closed_period',
    'skipped_accounting_not_configured', 'skipped_error'
  ));

ALTER TABLE bank_statement_lines
  DROP CONSTRAINT bank_statement_lines_matched_source_type_check,
  ADD CONSTRAINT bank_statement_lines_matched_source_type_check
    CHECK (matched_source_type IN ('invoice', 'purchase', 'shopify_payout', 'paypal_payout'));
