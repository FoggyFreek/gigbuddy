-- Two-store cleanup routing and resumable RustFS -> tenant S3 migrations.

ALTER TABLE storage_cleanup_queue
  ADD COLUMN store_target TEXT NOT NULL DEFAULT 'routed'
    CHECK (store_target IN ('routed', 'public', 'private', 'both'));

ALTER TABLE storage_cleanup_queue
  DROP CONSTRAINT IF EXISTS storage_cleanup_queue_object_key_key;

CREATE UNIQUE INDEX storage_cleanup_queue_key_store_idx
  ON storage_cleanup_queue (object_key, store_target);

CREATE TABLE storage_migrations (
  tenant_id                  INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  state                      TEXT NOT NULL DEFAULT 'not_scanned',
  requested_action           TEXT CHECK (requested_action IN ('inventory', 'copy', 'validate', 'delete_rustfs')),
  requested_by_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_object_count        INTEGER NOT NULL DEFAULT 0,
  source_bytes               BIGINT NOT NULL DEFAULT 0,
  copied_object_count        INTEGER NOT NULL DEFAULT 0,
  copied_bytes               BIGINT NOT NULL DEFAULT 0,
  database_references_checked INTEGER NOT NULL DEFAULT 0,
  missing_object_count       INTEGER NOT NULL DEFAULT 0,
  mismatch_count             INTEGER NOT NULL DEFAULT 0,
  inventory_fingerprint      TEXT,
  validated_fingerprint      TEXT,
  validated_at               TIMESTAMPTZ,
  error_code                 TEXT,
  lease_until                TIMESTAMPTZ,
  heartbeat_at               TIMESTAMPTZ,
  started_at                 TIMESTAMPTZ,
  completed_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX storage_migrations_work_idx
  ON storage_migrations (updated_at, tenant_id)
  WHERE requested_action IS NOT NULL;

CREATE TABLE storage_migration_objects (
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_key            TEXT NOT NULL,
  source_size           BIGINT NOT NULL,
  source_content_type   TEXT,
  source_fingerprint    TEXT NOT NULL,
  source_sha256         TEXT,
  destination_size      BIGINT,
  destination_sha256    TEXT,
  state                 TEXT NOT NULL DEFAULT 'pending',
  attempts              INTEGER NOT NULL DEFAULT 0,
  copied_at             TIMESTAMPTZ,
  verified_at           TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, object_key)
);
