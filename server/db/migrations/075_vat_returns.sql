-- VAT returns (declarations): period close for VAT.
-- 15000 / 24000 accumulate input/output VAT through the quarter; filing a
-- return zeroes them into a filed-return settlement account (15010 / 24010),
-- and payments/refunds against the tax authority move cash from/to the bank.
-- See plan: C:\Users\joris\.claude\plans\functional-design-vat-ticklish-fog.md

-- ---------- Settlement accounts for every existing tenant ----------
INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, '15010', 'VAT Receivable from Tax Authority', 'asset', '10000', true
  FROM tenants t
 WHERE EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = t.id AND c.code = '10000')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, '24010', 'VAT Payable to Tax Authority', 'liability', '20000', true
  FROM tenants t
 WHERE EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = t.id AND c.code = '20000')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ---------- Settlement account settings ----------
ALTER TABLE tenant_accounting_settings
  ADD COLUMN IF NOT EXISTS vat_receivable_settlement_account_code TEXT,
  ADD COLUMN IF NOT EXISTS vat_payable_settlement_account_code    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tas_vat_receivable_settlement_fk') THEN
    ALTER TABLE tenant_accounting_settings
      ADD CONSTRAINT tas_vat_receivable_settlement_fk
          FOREIGN KEY (tenant_id, vat_receivable_settlement_account_code)
          REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tas_vat_payable_settlement_fk') THEN
    ALTER TABLE tenant_accounting_settings
      ADD CONSTRAINT tas_vat_payable_settlement_fk
          FOREIGN KEY (tenant_id, vat_payable_settlement_account_code)
          REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
END $$;

UPDATE tenant_accounting_settings tas SET vat_receivable_settlement_account_code = '15010'
  WHERE vat_receivable_settlement_account_code IS NULL
    AND EXISTS (SELECT 1 FROM chart_of_accounts c
                WHERE c.tenant_id = tas.tenant_id AND c.code = '15010');
UPDATE tenant_accounting_settings tas SET vat_payable_settlement_account_code = '24010'
  WHERE vat_payable_settlement_account_code IS NULL
    AND EXISTS (SELECT 1 FROM chart_of_accounts c
                WHERE c.tenant_id = tas.tenant_id AND c.code = '24010');

-- ---------- VAT return headers ----------
-- One return per quarter: late corrections roll into the next quarter's return
-- (the settlement journal posts running-balance reversals, so anything posted
-- after a filing is exactly what the next filing picks up).
CREATE TABLE IF NOT EXISTS vat_returns (
  id                      SERIAL PRIMARY KEY,
  tenant_id               INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year                    INTEGER NOT NULL,
  quarter                 INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  period_from             DATE    NOT NULL,
  period_to               DATE    NOT NULL,
  input_vat_cents         INTEGER NOT NULL,
  output_vat_cents        INTEGER NOT NULL,
  net_cents               INTEGER NOT NULL,  -- output - input; >0 payable, <0 receivable
  direction               TEXT    NOT NULL CHECK (direction IN ('payable', 'receivable', 'nil')),
  settlement_account_code TEXT,              -- null when direction = 'nil'
  due_date                DATE    NOT NULL,
  notes                   TEXT,
  filed_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id      INTEGER REFERENCES users(id),
  UNIQUE (id, tenant_id),                    -- for composite child FKs
  UNIQUE (tenant_id, year, quarter),
  FOREIGN KEY (tenant_id, settlement_account_code) REFERENCES chart_of_accounts(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS vat_returns_tenant_period_idx
  ON vat_returns (tenant_id, year DESC, quarter DESC);

-- ---------- Payments / refunds against a filed return ----------
-- Each cash leg is its own ledger source so partial payments stay idempotent.
CREATE TABLE IF NOT EXISTS vat_return_payments (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vat_return_id      INTEGER NOT NULL,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  direction          TEXT    NOT NULL CHECK (direction IN ('payment', 'refund')),
  bank_account_code  TEXT    NOT NULL,
  paid_on            DATE    NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (vat_return_id, tenant_id) REFERENCES vat_returns(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, bank_account_code) REFERENCES chart_of_accounts(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS vat_return_payments_return_idx
  ON vat_return_payments (tenant_id, vat_return_id);
