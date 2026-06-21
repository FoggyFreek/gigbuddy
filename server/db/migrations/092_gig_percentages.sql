-- Venue deal terms beyond the flat guaranteed fee. Some venues take a cut of the
-- band's merchandise sales (settled afterwards), and some pay a percentage of net
-- ticket-sales revenue instead of a flat fee — when both a guaranteed fee and a
-- ticket-sales percentage are agreed, the band takes whichever turns out higher.
-- Both are stored as decimal percentages (e.g. 15.50 = 15.5%); range-checked 0–100.
ALTER TABLE gigs
  ADD COLUMN merchandise_cut NUMERIC(5, 2)
    CHECK (merchandise_cut IS NULL OR (merchandise_cut >= 0 AND merchandise_cut <= 100)),
  ADD COLUMN percentage_of_sales NUMERIC(5, 2)
    CHECK (percentage_of_sales IS NULL OR (percentage_of_sales >= 0 AND percentage_of_sales <= 100));
