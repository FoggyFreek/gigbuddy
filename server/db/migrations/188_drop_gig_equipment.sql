-- Drops the gig equipment feature. The gig_equipment table (migration 172) and
-- the three legacy booleans it superseded (migrations 004 and 036) go together:
-- nothing has read the booleans since 172, and nothing reads the table any more.
DROP TABLE IF EXISTS gig_equipment;

ALTER TABLE gigs
  DROP COLUMN IF EXISTS has_pa_system,
  DROP COLUMN IF EXISTS has_drumkit,
  DROP COLUMN IF EXISTS has_stage_lights;
