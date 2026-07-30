ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS kvk_number TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS kvk_number TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT;

CREATE INDEX IF NOT EXISTS contacts_tenant_supplier_tax_id_idx
  ON contacts (tenant_id, tax_id)
  WHERE category = 'supplier' AND tax_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_tenant_supplier_kvk_number_idx
  ON contacts (tenant_id, lower(kvk_number))
  WHERE category = 'supplier' AND kvk_number IS NOT NULL;
