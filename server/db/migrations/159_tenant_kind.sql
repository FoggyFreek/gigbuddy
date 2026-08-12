-- Tenants come in two kinds: a band (every existing row) and a musician's own
-- artist workspace. A personal workspace is an ordinary tenant — same ledger,
-- same isolation — the kind only decides which surfaces apply to it.
--
-- `display_name` is the kind-neutral name of `band_name`. Both columns exist for
-- now; tenantRepository is the single writer and keeps them in sync until a
-- follow-up migration drops `band_name` (expand-migrate-contract).
ALTER TABLE tenants
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'band'
    CHECK (kind IN ('band', 'personal')),
  ADD COLUMN display_name TEXT;

UPDATE tenants SET display_name = band_name WHERE display_name IS NULL;

-- A user owns at most one personal workspace; the service is idempotent and
-- this index is the backstop.
CREATE UNIQUE INDEX tenants_one_personal_per_owner
  ON tenants (owner_user_id) WHERE kind = 'personal';
