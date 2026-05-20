-- Link gigs to venues via a real FK.
-- Backfills in two passes: match existing venues by (lower(name), lower(city)),
-- then auto-create venues for any unmatched gigs so no data is lost. Finally
-- drops the legacy venue/city text columns.

-- 1. Composite UNIQUE on venues so the FK below can pin same-tenant.
ALTER TABLE venues
  ADD CONSTRAINT venues_id_tenant_id_key UNIQUE (id, tenant_id);

-- 2. Add the FK column.
ALTER TABLE gigs
  ADD COLUMN venue_id INTEGER;

-- 3. Composite FK. The (venue_id) column list on ON DELETE SET NULL is
-- required: without it Postgres would try to NULL gigs.tenant_id too, which
-- is NOT NULL.
ALTER TABLE gigs
  ADD CONSTRAINT gigs_venue_id_tenant_id_fkey
  FOREIGN KEY (venue_id, tenant_id) REFERENCES venues(id, tenant_id)
  ON DELETE SET NULL (venue_id);

-- 4. Backfill pass 1: link gigs whose (venue, city) already match a venue row
-- in the same tenant.
UPDATE gigs g
   SET venue_id = v.id
  FROM venues v
 WHERE v.tenant_id = g.tenant_id
   AND lower(v.name) = lower(g.venue)
   AND lower(coalesce(v.city, '')) = lower(coalesce(g.city, ''));

-- 5. Backfill pass 2: auto-create venues for unmatched gigs, then link.
-- DISTINCT ON dedupes by the same lowercased key the unique index uses, so
-- two gigs with "the venue" / "The Venue" collapse to one insert.
WITH missing AS (
  SELECT DISTINCT ON (g.tenant_id, lower(trim(g.venue)), lower(coalesce(trim(g.city), '')))
         g.tenant_id,
         trim(g.venue) AS name,
         NULLIF(trim(coalesce(g.city, '')), '') AS city
    FROM gigs g
   WHERE g.venue_id IS NULL
     AND g.venue IS NOT NULL
     AND trim(g.venue) <> ''
)
INSERT INTO venues (tenant_id, category, name, city)
SELECT tenant_id, 'venue', name, city FROM missing
ON CONFLICT DO NOTHING;

UPDATE gigs g
   SET venue_id = v.id
  FROM venues v
 WHERE g.venue_id IS NULL
   AND v.tenant_id = g.tenant_id
   AND lower(v.name) = lower(trim(g.venue))
   AND lower(coalesce(v.city, '')) = lower(coalesce(trim(g.city), ''));

-- 6. Drop the legacy text columns.
ALTER TABLE gigs
  DROP COLUMN venue,
  DROP COLUMN city;

-- 7. Index for the FK.
CREATE INDEX gigs_venue_id_idx ON gigs(venue_id);
