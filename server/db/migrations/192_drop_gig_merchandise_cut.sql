-- Drops the merchandise_cut deal term (migration 092). Unused and no longer
-- surfaced anywhere; percentage_of_sales (added alongside it) stays.
ALTER TABLE gigs
  DROP COLUMN IF EXISTS merchandise_cut;
