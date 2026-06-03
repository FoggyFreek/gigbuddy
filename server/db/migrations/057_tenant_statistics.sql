-- tenant_statistics: per-tenant rollup of object-storage usage.
-- One row per tenant; refreshed by statisticsService on every storageService
-- mutation (recompute = list the tenant's S3 prefix, sum sizes). Accounting
-- only — no quotas. tenant_id is the PK (no surrogate id) and cascades away
-- with its tenant.
CREATE TABLE tenant_statistics (
  tenant_id     INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  storage_bytes BIGINT  NOT NULL DEFAULT 0,
  object_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill a zero row for every existing tenant so reads always have a row.
-- (New tenants get theirs in the tenant-creation transaction; reads also
-- COALESCE as a backstop.)
INSERT INTO tenant_statistics (tenant_id)
  SELECT id FROM tenants
  ON CONFLICT (tenant_id) DO NOTHING;
