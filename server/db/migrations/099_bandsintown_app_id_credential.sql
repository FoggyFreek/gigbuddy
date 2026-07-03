-- Per-tenant Bandsintown API key (app_id), stored encrypted like the other
-- integration credentials (see 095). The plaintext column exists only for
-- repository symmetry with legacy credentials and stays NULL for new writes.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS bandsintown_app_id TEXT,
  ADD COLUMN IF NOT EXISTS bandsintown_app_id_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS bandsintown_app_id_changed_at TIMESTAMPTZ;
