-- Availability is the one planning domain where the tenant is the wrong
-- container: "busy on 14 March" is a fact about the person, not about any one
-- band. So it moves up to the user, and each band reads a redacted projection.
--
-- availability_slots stays for band_members rows with user_id IS NULL — dep
-- players and CRM-only entries have no account, and their availability is
-- genuinely band-local. The band-side read is a union of the two.
CREATE TABLE user_availability_slots (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
  reason               TEXT,
  -- Provenance for delegated edits: who wrote it, and from which band's screen.
  -- Both nullable and ON DELETE SET NULL: losing the author or the band must
  -- never take the musician's own calendar entry with it.
  created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_in_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_user_availability_user_range
  ON user_availability_slots (user_id, start_date, end_date);

-- Privacy is user-owned and global across bands. Both default to FALSE:
-- private by default, sharing is something the musician turns on.
ALTER TABLE users
  ADD COLUMN availability_detail_visible   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cross_band_gig_detail_visible BOOLEAN NOT NULL DEFAULT FALSE;

-- Per band: may this band maintain my calendar for me? Only the musician can
-- change it, and only from their own settings.
ALTER TABLE memberships
  ADD COLUMN availability_managed_by_band BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: every band-local slot belonging to a member who IS linked to a user
-- becomes that user's own slot, tagged with the band it was entered from. Rows
-- for unlinked members stay where they are. A member linked to a user later
-- moves their remaining slots up in the linking flow, not by a background job.
INSERT INTO user_availability_slots
  (user_id, start_date, end_date, status, reason, created_in_tenant_id, created_at, updated_at)
SELECT bm.user_id, s.start_date, s.end_date, s.status, s.reason, s.tenant_id, s.created_at, s.updated_at
  FROM availability_slots s
  JOIN band_members bm ON bm.id = s.band_member_id AND bm.tenant_id = s.tenant_id
 WHERE bm.user_id IS NOT NULL;

DELETE FROM availability_slots s
 USING band_members bm
 WHERE bm.id = s.band_member_id
   AND bm.tenant_id = s.tenant_id
   AND bm.user_id IS NOT NULL;
