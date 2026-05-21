-- Separate festival/event-organisation relationship from physical venue on gigs.
-- After this migration a gig can have:
--   venue_id    → physical performance location (venues.category = 'venue')
--   festival_id → festival / event organisation  (venues.category = 'festival')
--
-- Backfill: any existing gig whose venue_id currently points to a 'festival' row
-- is migrated: festival_id is set to that id and venue_id is cleared.

-- 1. Add the new column.
ALTER TABLE gigs ADD COLUMN festival_id INTEGER;

-- 2. Composite FK — ON DELETE SET NULL (festival_id) keeps the tenant_id intact.
ALTER TABLE gigs
  ADD CONSTRAINT gigs_festival_id_tenant_id_fkey
  FOREIGN KEY (festival_id, tenant_id) REFERENCES venues(id, tenant_id)
  ON DELETE SET NULL (festival_id);

-- 3. Backfill: move festival associations out of venue_id.
UPDATE gigs g
   SET festival_id = g.venue_id,
       venue_id    = NULL
  FROM venues v
 WHERE v.id       = g.venue_id
   AND v.tenant_id = g.tenant_id
   AND v.category  = 'festival';

-- 4. Performance index.
CREATE INDEX gigs_festival_id_idx ON gigs(festival_id);
