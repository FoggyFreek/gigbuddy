ALTER TABLE tenants
  ADD COLUMN slug_revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE linkpage_slug_sync_operations (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  old_slug         TEXT NOT NULL,
  new_slug         TEXT NOT NULL,
  slug_revision    BIGINT NOT NULL CHECK (slug_revision > 0),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'completed')),
  attempt_count    INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_code  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  UNIQUE (tenant_id, slug_revision)
);

CREATE INDEX linkpage_slug_sync_pending_idx
  ON linkpage_slug_sync_operations (next_attempt_at, id)
  WHERE status = 'pending';
