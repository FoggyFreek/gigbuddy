ALTER TABLE invoices
  ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'eur'
    CHECK (discount_type IN ('pct', 'eur')),
  ADD COLUMN discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0;
