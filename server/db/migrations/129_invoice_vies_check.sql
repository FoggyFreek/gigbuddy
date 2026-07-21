-- Reverse-charge due diligence. Zero-rating an intra-EU B2B supply is only
-- lawful when the supplier has established the customer's VAT number is valid;
-- the authoritative check is the EU VIES service. We do NOT integrate VIES here
-- (out of scope for a band's handful of foreign gigs); instead the issuer must
-- explicitly confirm they checked the number in VIES before the reverse-charge
-- invoice can be issued, and we retain that attestation as evidence.
--
--   vies_checked_at          — when the issuer confirmed the VIES check (proof
--                              timestamp; NULL = not yet confirmed).
--   vies_checked_vat_number  — the customer VAT number that was checked, snapshot
--                              at confirmation. If customer_tax_id later changes,
--                              this no longer matches and the attestation is stale
--                              (a fresh check is required before issuing).
--   vies_consultation_number — optional VIES request/consultation identifier the
--                              issuer can record as stronger evidence.
ALTER TABLE invoices
  ADD COLUMN vies_checked_at TIMESTAMPTZ,
  ADD COLUMN vies_checked_vat_number TEXT,
  ADD COLUMN vies_consultation_number TEXT;
