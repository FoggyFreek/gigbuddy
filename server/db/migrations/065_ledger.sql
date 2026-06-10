-- Double-entry ledger engine (feature-ledger).
-- A single durable record of money movement: every money-related transition in
-- invoicing and purchasing writes a balanced journal entry against the chart of
-- accounts. See plan:
-- C:\Users\joris\.claude\plans\double-entry-ledger-engine-whimsical-bentley.md

-- ---------- VAT account settings ----------
-- Output VAT (sales, a liability) and input VAT (purchases, a claimable asset)
-- are configured per tenant alongside the existing account defaults.
ALTER TABLE tenant_accounting_settings
  ADD COLUMN IF NOT EXISTS output_vat_account_code TEXT,
  ADD COLUMN IF NOT EXISTS input_vat_account_code  TEXT;

ALTER TABLE tenant_accounting_settings
  ADD CONSTRAINT tas_output_vat_fk FOREIGN KEY (tenant_id, output_vat_account_code)
      REFERENCES chart_of_accounts(tenant_id, code),
  ADD CONSTRAINT tas_input_vat_fk  FOREIGN KEY (tenant_id, input_vat_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);

-- Backfill existing tenants with the seeded VAT accounts when they still exist.
UPDATE tenant_accounting_settings tas SET output_vat_account_code = '24000'
  WHERE output_vat_account_code IS NULL
    AND EXISTS (SELECT 1 FROM chart_of_accounts c
                WHERE c.tenant_id = tas.tenant_id AND c.code = '24000');
UPDATE tenant_accounting_settings tas SET input_vat_account_code = '15000'
  WHERE input_vat_account_code IS NULL
    AND EXISTS (SELECT 1 FROM chart_of_accounts c
                WHERE c.tenant_id = tas.tenant_id AND c.code = '15000');

-- ---------- Expense account on purchase lines ----------
-- Each bill line debits a specific expense / COGS account. Defaults to the
-- tenant default_expense_account_code when omitted.
ALTER TABLE purchase_lines ADD COLUMN IF NOT EXISTS account_code TEXT;
ALTER TABLE purchase_lines ADD CONSTRAINT purchase_lines_account_fk
  FOREIGN KEY (tenant_id, account_code) REFERENCES chart_of_accounts(tenant_id, code);

UPDATE purchase_lines pl SET account_code = tas.default_expense_account_code
  FROM tenant_accounting_settings tas
  WHERE tas.tenant_id = pl.tenant_id AND pl.account_code IS NULL;

-- ---------- Member-paid tracking on purchases ----------
-- Records how a bill was settled and which band member fronted the cash. Does
-- not change the payment journal (both methods: DR payable / CR checking).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method  TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid_by_user_id INTEGER REFERENCES users(id);

-- ---------- Ledger tables ----------
CREATE TABLE ledger_transactions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL,      -- 'invoice' | 'purchase'
  source_id INTEGER NOT NULL,
  source_event TEXT NOT NULL,     -- 'sent' | 'paid' | 'void' | 'accrued'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  -- One journal per (entity, event): makes posting idempotent across the many
  -- code paths that can drive the same transition.
  UNIQUE (tenant_id, source_type, source_id, source_event)
);

CREATE TABLE ledger_entries (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  contact_id INTEGER,             -- optional counterparty
  debit_cents  INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents  >= 0),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one side of each entry line is non-zero.
  CONSTRAINT ledger_entries_one_sided CHECK ((debit_cents = 0) <> (credit_cents = 0)),
  CONSTRAINT ledger_entries_txn_fkey
    FOREIGN KEY (transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ledger_entries_account_fkey
    FOREIGN KEY (tenant_id, account_code) REFERENCES chart_of_accounts(tenant_id, code),
  -- Column-list SET NULL so only contact_id is nulled, never tenant_id
  -- (mirrors purchases.supplier_contact_id in 063_purchases.sql).
  CONSTRAINT ledger_entries_contact_fkey
    FOREIGN KEY (contact_id, tenant_id) REFERENCES contacts(id, tenant_id)
    ON DELETE SET NULL (contact_id)
);

CREATE INDEX idx_ledger_entries_tenant_account ON ledger_entries(tenant_id, account_code);
CREATE INDEX idx_ledger_entries_txn ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_transactions_source ON ledger_transactions(tenant_id, source_type, source_id);
