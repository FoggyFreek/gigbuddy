-- Invoice emails are authored as outreach templates. A template's CONTEXT decides
-- which merge fields it may use; existing templates are all venue-facing.
ALTER TABLE outreach_templates ADD COLUMN context TEXT NOT NULL DEFAULT 'venue'
  CHECK (context IN ('venue','invoice'));

-- One campaign model now covers both bulk venue outreach and a single
-- transactional invoice email; `type` discriminates them in the send history.
ALTER TABLE outreach_campaigns ADD COLUMN type TEXT NOT NULL DEFAULT 'outreach'
  CHECK (type IN ('outreach','invoice'));
ALTER TABLE outreach_campaigns ADD COLUMN invoice_id INTEGER;
ALTER TABLE outreach_campaigns ADD COLUMN attachments TEXT NOT NULL DEFAULT 'pdf'
  CHECK (attachments IN ('pdf','pdf_xml','pdf_xml_embedded'));

-- Composite FK with an explicit column list on SET NULL: only invoice_id is
-- nullified, tenant_id stays (it is NOT NULL). Same pattern as
-- 046_invoices.sql's invoices_gig_id_tenant_id_fkey.
ALTER TABLE outreach_campaigns ADD CONSTRAINT outreach_campaigns_invoice_id_tenant_id_fkey
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES invoices (id, tenant_id)
  ON DELETE SET NULL (invoice_id);

CREATE INDEX outreach_campaigns_invoice_idx ON outreach_campaigns (invoice_id, tenant_id);
