-- Marks which attachment IS the invoice rather than a picture of one.
--
-- An imported e-invoice's structured file is accounting evidence, not a
-- convenience copy: German retention rules require the structured component to
-- be kept intact in its original form, and where a hybrid document's PDF and
-- XML disagree the XML is the authoritative one. An XRechnung has no PDF at all
-- — the XML is the invoice.
--
-- 'receipt' is every attachment a user uploads by hand (the existing behaviour,
-- and the default for existing rows). 'source_e_invoice' is the exact bytes an
-- import was parsed from, which the API refuses to delete.
ALTER TABLE purchase_attachments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'receipt'
    CHECK (kind IN ('receipt', 'source_e_invoice'));

-- Lets the stored bytes be proven unchanged without re-reading object storage,
-- and lets a re-upload of the same document be recognised.
ALTER TABLE purchase_attachments
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

-- One source document per purchase: a second import into the same purchase
-- would make "which file is this bill" unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_attachments_one_source_key
  ON purchase_attachments (purchase_id, tenant_id)
  WHERE kind = 'source_e_invoice';
