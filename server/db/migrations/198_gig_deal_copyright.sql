-- Copyright / PRS is a ticket-revenue deduction calculated after the VAT
-- contained in ticket receipts has been removed. NULL means no deduction was
-- agreed. Like the other gig tax terms, it only applies when subject_to_vat is
-- true.
ALTER TABLE gigs
  ADD COLUMN copyright_percentage NUMERIC(5, 2)
    CHECK (copyright_percentage IS NULL OR (copyright_percentage >= 0 AND copyright_percentage <= 100));
