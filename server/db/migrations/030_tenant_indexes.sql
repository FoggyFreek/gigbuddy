-- Phase 4: composite tenant-prefixed indexes. Drop legacy single-column
-- indexes that are subsumed by the new composites or by Phase 1 indexes.

CREATE INDEX idx_gigs_tenant_event_date           ON gigs(tenant_id, event_date);
CREATE INDEX idx_band_events_tenant_range         ON band_events(tenant_id, start_date, end_date);
CREATE INDEX idx_availability_slots_tenant_range  ON availability_slots(tenant_id, start_date, end_date);
CREATE INDEX idx_band_members_tenant_sort         ON band_members(tenant_id, sort_order);
CREATE INDEX idx_share_photos_tenant_sort         ON share_photos(tenant_id, sort_order);
CREATE INDEX idx_profile_links_tenant_sort        ON profile_links(tenant_id, sort_order);

-- Drop legacy single-column / global indexes superseded by tenant-prefixed ones.
DROP INDEX IF EXISTS band_events_start_date_idx;
DROP INDEX IF EXISTS idx_avail_range;
DROP INDEX IF EXISTS rehearsals_proposed_date_idx;

-- The tenant_id-only indexes from migration 025 stay; they're still useful for
-- COUNT/JOIN on a single tenant where the secondary column is irrelevant.
