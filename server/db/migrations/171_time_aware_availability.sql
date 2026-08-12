-- Per-user travel time around bookings. Unlinked roster members use the same
-- two-hour default in application code because they have no users row.
ALTER TABLE users
  ADD COLUMN availability_travel_margin_hours SMALLINT NOT NULL DEFAULT 2
    CHECK (availability_travel_margin_hours BETWEEN 0 AND 24);

-- Roster removal is soft so completed events retain their participant history.
-- Current roster reads and limits filter deleted_at; tenant deletion still
-- physically removes the rows through the existing tenant ownership chain.
ALTER TABLE band_members
  ADD COLUMN deleted_at TIMESTAMPTZ;

DROP INDEX band_members_user_tenant_unique;
CREATE UNIQUE INDEX band_members_user_tenant_unique
  ON band_members (user_id, tenant_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX band_members_active_tenant_idx
  ON band_members (tenant_id, sort_order, id)
  WHERE deleted_at IS NULL;

-- Existing installations may contain old overnight-looking values, so add
-- these as NOT VALID: every new/changed row is enforced without blocking the
-- deployment on historical data.
ALTER TABLE gigs ADD CONSTRAINT gigs_daily_time_range_check
  CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time) NOT VALID;
ALTER TABLE rehearsals ADD CONSTRAINT rehearsals_daily_time_range_check
  CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time) NOT VALID;
ALTER TABLE band_events ADD CONSTRAINT band_events_daily_time_range_check
  CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time) NOT VALID;
