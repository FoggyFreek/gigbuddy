ALTER TABLE tenants
  ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX idx_tenants_archived_at ON tenants(archived_at) WHERE archived_at IS NULL;
