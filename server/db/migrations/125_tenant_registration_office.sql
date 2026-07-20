-- Company / commercial registration is court-, city- or province-scoped in some
-- countries (Germany's Amtsgericht, France's RCS ville, Austria's Firmenbuchgericht,
-- Italy's REA provincia), and that office must appear on the invoice alongside the
-- registration number. Store it in one nullable column; the existing kvk_number
-- column holds the number itself (now validated per VAT country against
-- shared/businessRegistry.js). Countries without an office-scoped register leave
-- this NULL. The supplier's registration is read live from the tenant row at PDF
-- render time, so no invoice-side snapshot column is needed.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS registration_office TEXT;
