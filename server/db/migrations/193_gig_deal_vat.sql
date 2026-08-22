-- VAT on a gig deal: whether the deal is taxed at all, the rate an invoice
-- generated from it is billed at, and the VAT the venue charges the public,
-- which is contained in the nett ticket price.
--
-- `subject_to_vat` is the discriminator: false means this deal carries no VAT,
-- so an invoice drawn from it is billed at 0% and nothing is stripped out of
-- ticket revenue. It defaults to TRUE, which is what every existing gig is —
-- a performance is a taxed supply unless the tenant's scheme says otherwise
-- (an exempt scheme still overrides this at invoicing time).
--
-- The two percentages are OVERRIDES, not state: a NULL general rate means the
-- gig does not override the rate an invoice would otherwise default to (the
-- country's reduced rate for a live performance), and a NULL ticket rate means
-- the nett ticket price carries no VAT to take out. Whether VAT applies at all
-- is never read from their NULL-ness — that is `subject_to_vat`'s job.
ALTER TABLE gigs
  ADD COLUMN subject_to_vat BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN vat_percentage NUMERIC(5, 2)
    CHECK (vat_percentage IS NULL OR (vat_percentage >= 0 AND vat_percentage <= 100)),
  ADD COLUMN ticket_vat_percentage NUMERIC(5, 2)
    CHECK (ticket_vat_percentage IS NULL OR (ticket_vat_percentage >= 0 AND ticket_vat_percentage <= 100));
