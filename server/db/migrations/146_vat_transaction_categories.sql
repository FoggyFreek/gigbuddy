-- Dutch VAT workpapers need transaction facts, not a percentage-only reading of
-- two running control-account balances. This migration is additive: existing
-- documents and returns retain their historical amounts and are marked as the
-- legacy generic calculation mode.

-- Draft/source rows carry the user's classification. The immutable snapshot
-- used by reporting lives in ledger_tax_facts once the source is posted.
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS tax_category_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_code TEXT;

ALTER TABLE purchase_lines
  ADD COLUMN IF NOT EXISTS tax_category_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_code TEXT,
  ADD COLUMN IF NOT EXISTS input_vat_recovery_percent NUMERIC(5,2);

ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS tax_category_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_code TEXT,
  ADD COLUMN IF NOT EXISTS input_vat_recovery_percent NUMERIC(5,2);

ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS tax_category_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_code TEXT,
  ADD COLUMN IF NOT EXISTS input_vat_recovery_percent NUMERIC(5,2);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tax_category_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_code TEXT;

ALTER TABLE merch_sales
  ADD COLUMN IF NOT EXISTS tax_category_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_code TEXT,
  ADD COLUMN IF NOT EXISTS vat_treatment_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vat_scheme_code_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS accounting_country_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS tax_category_version TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_lines_vat_recovery_range') THEN
    ALTER TABLE purchase_lines ADD CONSTRAINT purchase_lines_vat_recovery_range
      CHECK (input_vat_recovery_percent IS NULL OR input_vat_recovery_percent BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_lines_vat_recovery_range') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_vat_recovery_range
      CHECK (input_vat_recovery_percent IS NULL OR input_vat_recovery_percent BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_lines_vat_recovery_range') THEN
    ALTER TABLE bank_statement_lines ADD CONSTRAINT bank_lines_vat_recovery_range
      CHECK (input_vat_recovery_percent IS NULL OR input_vat_recovery_percent BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ledger_tax_facts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL,
  source_line_kind TEXT,
  source_line_id BIGINT,
  source_line_position INTEGER,
  tax_point DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('sale', 'purchase', 'adjustment')),
  tax_jurisdiction_code TEXT NOT NULL
    CHECK (tax_jurisdiction_code ~ '^[a-z]{2}$'),
  counterparty_country_code TEXT
    CHECK (counterparty_country_code IS NULL OR counterparty_country_code ~ '^[a-z]{2}$'),
  category_code TEXT NOT NULL,
  category_version TEXT NOT NULL,
  treatment TEXT NOT NULL CHECK (treatment IN (
    'standard', 'reduced', 'zero_rated', 'exempt_no_credit',
    'outside_scope', 'reverse_charge', 'small_business_exempt'
  )),
  scheme_code TEXT,
  rate NUMERIC(7,4) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  recovery_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (recovery_percent BETWEEN 0 AND 100),
  taxable_base_cents INTEGER NOT NULL,
  tax_amount_cents INTEGER NOT NULL,
  output_vat_cents INTEGER NOT NULL DEFAULT 0,
  deductible_input_vat_cents INTEGER NOT NULL DEFAULT 0,
  non_deductible_input_vat_cents INTEGER NOT NULL DEFAULT 0,
  classification_status TEXT NOT NULL
    CHECK (classification_status IN ('confirmed', 'legacy_inferred', 'unclassified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ledger_tax_facts_period_idx
  ON ledger_tax_facts (tenant_id, tax_jurisdiction_code, tax_point, id);
CREATE INDEX IF NOT EXISTS ledger_tax_facts_transaction_idx
  ON ledger_tax_facts (tenant_id, transaction_id);

-- The informational VAT lock is distinct from books_closed_through. Late
-- postings remain possible and surface as amendment deltas.
ALTER TABLE tenant_accounting_profiles
  ADD COLUMN IF NOT EXISTS vat_period_locked_through DATE;

-- Submitted returns settle whole euros while control accounts hold cents.
INSERT INTO chart_of_accounts (
  tenant_id, code, name, type, parent_code, is_system, is_capitalizable, reporting_group
)
SELECT t.id, '64900', 'VAT rounding differences', 'expense', '64000', true, false, 'operating_expense'
  FROM tenants t
 WHERE EXISTS (
   SELECT 1 FROM chart_of_accounts c
    WHERE c.tenant_id = t.id AND c.code = '64000'
 )
ON CONFLICT (tenant_id, code) DO NOTHING;

ALTER TABLE tenant_accounting_settings
  ADD COLUMN IF NOT EXISTS vat_rounding_account_code TEXT;

UPDATE tenant_accounting_settings tas
   SET vat_rounding_account_code = '64900'
 WHERE vat_rounding_account_code IS NULL
   AND EXISTS (
     SELECT 1 FROM chart_of_accounts c
      WHERE c.tenant_id = tas.tenant_id AND c.code = '64900'
   );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tas_vat_rounding_fk') THEN
    ALTER TABLE tenant_accounting_settings
      ADD CONSTRAINT tas_vat_rounding_fk
      FOREIGN KEY (tenant_id, vat_rounding_account_code)
      REFERENCES chart_of_accounts(tenant_id, code);
  END IF;
END $$;

-- Existing rows are already submitted legacy settlements. New Dutch rows move
-- through prepared -> submitted and preserve their frozen box/reconciliation
-- snapshots.
ALTER TABLE vat_returns
  ALTER COLUMN year DROP NOT NULL,
  ALTER COLUMN quarter DROP NOT NULL,
  ALTER COLUMN filed_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS period_key TEXT,
  ADD COLUMN IF NOT EXISTS schema_country_code TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS calculation_mode TEXT NOT NULL DEFAULT 'legacy_generic'
    CHECK (calculation_mode IN ('legacy_generic', 'category_workpaper')),
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (workflow_status IN ('prepared', 'submitted', 'superseded')),
  ADD COLUMN IF NOT EXISTS filing_frequency_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS raw_input_vat_cents INTEGER,
  ADD COLUMN IF NOT EXISTS raw_output_vat_cents INTEGER,
  ADD COLUMN IF NOT EXISTS raw_net_cents INTEGER,
  ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prepared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submission_reference TEXT,
  ADD COLUMN IF NOT EXISTS boxes_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS reconciliation_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS exceptions_snapshot JSONB;

ALTER TABLE vat_returns
  DROP CONSTRAINT IF EXISTS vat_returns_tenant_id_year_quarter_key;

UPDATE vat_returns vr
   SET period_key = COALESCE(period_key, year::text || '-Q' || quarter::text),
       schema_country_code = COALESCE(
         schema_country_code,
         (SELECT p.country_code FROM tenant_accounting_profiles p WHERE p.tenant_id = vr.tenant_id)
       ),
       schema_version = COALESCE(schema_version, 'legacy-v1'),
       calculation_mode = 'legacy_generic',
       workflow_status = 'submitted',
       raw_input_vat_cents = COALESCE(raw_input_vat_cents, input_vat_cents),
       raw_output_vat_cents = COALESCE(raw_output_vat_cents, output_vat_cents),
       raw_net_cents = COALESCE(raw_net_cents, net_cents),
       prepared_at = COALESCE(prepared_at, filed_at),
       submitted_at = COALESCE(submitted_at, filed_at);

CREATE UNIQUE INDEX IF NOT EXISTS vat_returns_active_period_key
  ON vat_returns (tenant_id, period_from, period_to)
  WHERE workflow_status <> 'superseded';

CREATE TABLE IF NOT EXISTS vat_return_box_values (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vat_return_id INTEGER NOT NULL,
  box_code TEXT NOT NULL,
  base_raw_cents INTEGER NOT NULL DEFAULT 0,
  vat_raw_cents INTEGER NOT NULL DEFAULT 0,
  base_declared_euros INTEGER,
  vat_declared_euros INTEGER,
  UNIQUE (vat_return_id, tenant_id, box_code),
  FOREIGN KEY (vat_return_id, tenant_id)
    REFERENCES vat_returns(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vat_return_tax_facts (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vat_return_id INTEGER NOT NULL,
  tax_fact_id BIGINT NOT NULL,
  inclusion_kind TEXT NOT NULL CHECK (inclusion_kind IN ('period', 'amendment', 'legacy_assigned')),
  PRIMARY KEY (tenant_id, vat_return_id, tax_fact_id),
  UNIQUE (tenant_id, tax_fact_id),
  FOREIGN KEY (vat_return_id, tenant_id)
    REFERENCES vat_returns(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tax_fact_id, tenant_id)
    REFERENCES ledger_tax_facts(id, tenant_id)
);

CREATE TABLE IF NOT EXISTS vat_return_exception_acknowledgements (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vat_return_id INTEGER NOT NULL,
  exception_key TEXT NOT NULL,
  note TEXT NOT NULL,
  acknowledged_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vat_return_id, tenant_id, exception_key),
  FOREIGN KEY (vat_return_id, tenant_id)
    REFERENCES vat_returns(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vat_return_evidence (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vat_return_id INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (vat_return_id, tenant_id)
    REFERENCES vat_returns(id, tenant_id) ON DELETE CASCADE
);
