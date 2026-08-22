ALTER TABLE tenants ADD COLUMN IF NOT EXISTS preferred_invoice_mode TEXT
  NOT NULL DEFAULT 'combined'
  CONSTRAINT tenants_preferred_invoice_mode_check
  CHECK (preferred_invoice_mode IN ('combined', 'specified'));
