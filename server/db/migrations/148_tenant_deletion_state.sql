-- Persist the object-store purge phase so tenant deletion never holds a long
-- PostgreSQL transaction open across external storage calls.
ALTER TABLE tenants
  ADD COLUMN deletion_status TEXT
    CHECK (deletion_status IN ('pending', 'failed')),
  ADD COLUMN deletion_error_code TEXT,
  ADD COLUMN deletion_requested_at TIMESTAMPTZ;
