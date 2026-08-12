-- Discoverability is opt-in per band. The default preserves today's behaviour
-- exactly: no existing band becomes findable until a tenant admin turns it on,
-- and a personal workspace is excluded structurally (kind = 'band'), never
-- merely default-off.
ALTER TABLE tenants
  ADD COLUMN join_policy TEXT NOT NULL DEFAULT 'invite_only'
    CHECK (join_policy IN ('invite_only', 'request'));

-- Case-insensitive prefix/substring search over the (small) discoverable set.
CREATE INDEX idx_tenants_discoverable
  ON tenants (kind, join_policy)
  WHERE archived_at IS NULL;

-- How a membership came to exist, plus the requester's note to the band.
--
-- `source` gets no SQL default on purpose: every insert site names its own
-- value. Pre-existing rows are marked 'legacy' because they genuinely cannot be
-- reconstructed.
ALTER TABLE memberships
  ADD COLUMN request_message TEXT,
  ADD COLUMN source TEXT;

UPDATE memberships SET source = 'legacy' WHERE source IS NULL;

ALTER TABLE memberships
  ALTER COLUMN source SET NOT NULL,
  ADD CONSTRAINT memberships_source_check
    CHECK (source IN ('invite', 'request', 'admin', 'owner', 'legacy'));

-- The outstanding-join-request cap counts exactly this predicate.
CREATE INDEX idx_memberships_open_requests
  ON memberships (user_id)
  WHERE status = 'pending' AND source = 'request';
