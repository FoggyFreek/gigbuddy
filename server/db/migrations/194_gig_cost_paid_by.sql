-- Who a gig cost line is paid by, which decides how it moves through the
-- artist statement (src/planning/gigs/dealTerms.ts):
--   artist_agency — deducted from the gross fee before the booking fee is
--                   calculated, so both sides bear a share through the
--                   reduced base.
--   artist        — deducted only from what is due to the artist; the
--                   booking fee is unaffected. This is the pre-existing
--                   behaviour, so it is the default for every current row.
--   agency        — deducted from what is due to the booker; the amount due
--                   to the artist is unaffected.
ALTER TABLE gig_costs
  ADD COLUMN paid_by TEXT NOT NULL DEFAULT 'artist'
    CHECK (paid_by IN ('artist_agency', 'artist', 'agency'));
