ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS supplier_import_data JSONB;

ALTER TABLE purchases
  ADD CONSTRAINT purchases_supplier_import_data_object_check
  CHECK (supplier_import_data IS NULL OR jsonb_typeof(supplier_import_data) = 'object');
