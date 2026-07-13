-- Ledger transaction notes + account reclassification (feature-ledger).
--
-- Notes: every ledger transaction (incl. voided/corrected ones) can carry one
-- editable free-text note with last-editor audit metadata. A draft journal also
-- carries a note that is copied onto its posted ledger transaction on approval;
-- from then on the transaction note is the canonical, editable copy.
--
-- Reclassification: a journal may record that it moves one posted ledger line
-- (ledger_entries row) to another account. The tenant-safe composite FK plus
-- the partial unique index guarantee at most one reclassification journal per
-- source line, even under concurrent requests.

ALTER TABLE ledger_transactions
  ADD COLUMN note TEXT,
  ADD COLUMN note_updated_at TIMESTAMPTZ,
  ADD COLUMN note_updated_by_user_id INTEGER REFERENCES users(id);

-- Parent-side composite key so children can FK on (id, tenant_id) — the same
-- cross-tenant backstop pattern every tenant-owned parent table uses.
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE journals
  ADD COLUMN note TEXT,
  ADD COLUMN reclassifies_ledger_entry_id INTEGER;

ALTER TABLE journals
  ADD CONSTRAINT journals_reclassifies_fkey
    FOREIGN KEY (reclassifies_ledger_entry_id, tenant_id)
    REFERENCES ledger_entries(id, tenant_id);

-- One reclassification (draft or approved) per source ledger line.
CREATE UNIQUE INDEX journals_reclassifies_unique
  ON journals (tenant_id, reclassifies_ledger_entry_id)
  WHERE reclassifies_ledger_entry_id IS NOT NULL;
