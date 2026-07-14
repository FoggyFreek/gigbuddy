-- Bank statement import (feature: import CAMT.053 / SWIFT MT940 into the ledger).
--
-- Two-phase: parse+stage (this stores the parsed lines authoritatively so commit
-- never trusts client money) then commit (each line posts one ledger journal, or
-- reconciles an existing invoice/purchase). See plan:
-- C:\Users\joris\.claude\plans\support-importing-cant-053-playful-stardust.md

-- ---------- Imports (one uploaded file) ----------
CREATE TABLE bank_statement_imports (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('camt053', 'mt940')),
  currency TEXT,
  statement_ref TEXT,
  account_iban TEXT,
  -- sha256 of the raw uploaded bytes: re-uploading the exact same file is a
  -- no-op (returns the existing import) rather than a duplicate stage.
  file_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'committed')),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Composite-FK target for bank_statement_lines (tenant-safe child links).
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, file_hash)
);

-- ---------- Lines (one staged transaction) ----------
-- No global content fingerprint: recurring rent, bank fees, or two identical
-- payments in one statement legitimately share date+amount+IBAN+remittance, so a
-- unique on those would silently discard real transactions. Dedup is the exact
-- file_hash (hard) plus bank-provided bank_ref/end_to_end_id (soft "possibly
-- already imported" flag). Per-line ledger idempotency comes from the
-- ledger_transactions unique on (tenant_id, source_type, source_id, source_event)
-- where source_id = this row's id.
CREATE TABLE bank_statement_lines (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id INTEGER NOT NULL,
  line_index INTEGER NOT NULL,
  booking_date DATE NOT NULL,
  value_date DATE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  currency TEXT,
  counterparty_name TEXT,
  counterparty_iban TEXT,
  remittance_info TEXT,
  bank_ref TEXT,
  end_to_end_id TEXT,
  is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'imported', 'skipped',
      'reconciled_invoice', 'reconciled_purchase',
      'skipped_currency', 'skipped_closed_period',
      'skipped_accounting_not_configured', 'skipped_error'
    )),
  ledger_transaction_id INTEGER,
  matched_source_type TEXT CHECK (matched_source_type IN ('invoice', 'purchase')),
  matched_source_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (import_id, line_index),
  CONSTRAINT bank_statement_lines_import_fkey
    FOREIGN KEY (import_id, tenant_id)
    REFERENCES bank_statement_imports(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT bank_statement_lines_ledger_txn_fkey
    FOREIGN KEY (ledger_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id)
);

CREATE INDEX bank_statement_lines_import_idx
  ON bank_statement_lines (tenant_id, import_id);
-- Soft cross-import duplicate detection by bank-provided reference.
CREATE INDEX bank_statement_lines_bank_ref_idx
  ON bank_statement_lines (tenant_id, bank_ref) WHERE bank_ref IS NOT NULL;
