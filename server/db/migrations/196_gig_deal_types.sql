ALTER TABLE gigs ADD COLUMN guarantee_variant TEXT
  CONSTRAINT gigs_guarantee_variant_value_check
  CHECK (guarantee_variant IS NULL OR guarantee_variant IN ('plus', 'versus'));

UPDATE gigs SET guarantee_variant = 'plus', breakeven_includes_venue_costs = TRUE
 WHERE deal_type = 'guarantee';
UPDATE gigs SET guarantee_variant = 'plus' WHERE deal_type = 'guarantee_plus';
UPDATE gigs SET guarantee_variant = 'versus' WHERE deal_type = 'guarantee_vs';
UPDATE gigs SET deal_type = 'guarantee'
 WHERE deal_type IN ('guarantee_plus', 'guarantee_vs');

ALTER TABLE gigs DROP CONSTRAINT gigs_deal_type_check;
ALTER TABLE gigs ADD CONSTRAINT gigs_deal_type_check
  CHECK (deal_type IN ('flat_fee', 'guarantee', 'door_deal'));

ALTER TABLE gigs ADD CONSTRAINT gigs_guarantee_variant_check
  CHECK ((deal_type = 'guarantee') = (guarantee_variant IS NOT NULL));
