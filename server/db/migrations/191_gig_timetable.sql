-- Gig timetable: the running order of a gig day as discrete lines
-- (get-in, soundcheck, doors, stage time, …) on the Tasks tab.
--
-- Deliberately structured rather than another free-text info block: the lines
-- are dragged into order, so each one needs its own row and position.
--
-- Both times are nullable because a line is added before it is filled in, and
-- a line may legitimately carry only a description. A zero-length item is
-- expressed by end_time = start_time; no ordering constraint is enforced, a
-- timetable that crosses midnight is normal.
--
-- Composite FK is the tenant-isolation backstop; depends on
-- gigs_id_tenant_id_key (028).
CREATE TABLE IF NOT EXISTS gig_timetable_entries (
  id          SERIAL PRIMARY KEY,
  gig_id      INTEGER NOT NULL,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  start_time  TIME,
  end_time    TIME,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS gig_timetable_entries_gig_idx
  ON gig_timetable_entries (gig_id, tenant_id, position);
