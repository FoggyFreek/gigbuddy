-- Journal: user-entered postings on the band's own ledger (feature-ledger).
-- Drafts are editable here; approving posts a balanced journal to the immutable
-- ledger (server/services/ledgerService.js, source_type='journal'). Draft rows
-- are intentionally permissive (account_code/side may be NULL while the user is
-- still filling a row in); postability is enforced at approve time, not by the
-- schema.

-- ---------- per-tenant journal number sequence ----------
-- Atomic UPSERT counter avoids the MAX(entry_number)+1 race, mirroring
-- purchase_number_sequences in 063_purchases.sql.
CREATE TABLE journal_number_sequences (
  tenant_id INTEGER NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_seq INTEGER NOT NULL DEFAULT 1
);

-- ---------- journals (draft header) ----------
CREATE TABLE journals (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_number INTEGER NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  posted_transaction_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, entry_number),
  -- Approved <=> posted to the immutable ledger; draft <=> not yet posted.
  CONSTRAINT journals_posted_state CHECK (
    (status = 'draft'    AND posted_transaction_id IS NULL) OR
    (status = 'approved' AND posted_transaction_id IS NOT NULL)
  ),
  CONSTRAINT journals_txn_fkey
    FOREIGN KEY (posted_transaction_id, tenant_id)
    REFERENCES ledger_transactions(id, tenant_id)
);

-- ---------- journal_lines ----------
CREATE TABLE journal_lines (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  account_code TEXT,            -- NULL while drafting; required at approve time
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  side TEXT,                    -- NULL while drafting; 'debit' | 'credit' at approve time
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),  -- gross (incl. VAT)
  balancing_account_code TEXT,
  CONSTRAINT journal_lines_side CHECK (side IS NULL OR side IN ('debit', 'credit')),
  CONSTRAINT journal_lines_journal_fkey
    FOREIGN KEY (journal_id, tenant_id)
    REFERENCES journals(id, tenant_id) ON DELETE CASCADE,
  -- FK still rejects a non-null code that isn't in the tenant's chart; NULL is
  -- allowed while the row is being drafted.
  CONSTRAINT journal_lines_account_fkey
    FOREIGN KEY (tenant_id, account_code) REFERENCES chart_of_accounts(tenant_id, code),
  CONSTRAINT journal_lines_balancing_fkey
    FOREIGN KEY (tenant_id, balancing_account_code) REFERENCES chart_of_accounts(tenant_id, code)
);

CREATE INDEX idx_journal_lines_tenant_journal ON journal_lines(tenant_id, journal_id);
