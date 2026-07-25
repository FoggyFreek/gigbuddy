-- Invoice compliance (EU VAT Directive 2006/112/EC, art. 226):
--   reverse_charge — manually flagged; when set, VAT is 0, the customer's VAT
--     number is required, and the invoice carries the "Reverse charge — Article
--     196 EU VAT Directive" notation (cross-border B2B, e.g. a gig abroad).
--   supply_date    — the date the service was supplied (art. 226(7)); snapshotted
--     from the gig's event date at creation, editable, printed when it differs
--     from the issue date.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supply_date DATE;
