-- Legal form of the band, scoped to what a music group realistically is. Most
-- bands are a sole trader or an informal partnership and owe nothing beyond the
-- EU Art. 226 invoice essentials. Only an incorporated band (a company) owes the
-- national company-law disclosures on its invoices — e.g. Germany's GmbHG §35a
-- (managing directors + register court + number) or France's société mentions.
-- So `directors` (managing directors / bestuurders) is stored optionally and
-- only rendered when legal_form = 'company'. The list mirrors LEGAL_FORMS in
-- shared/businessRegistry.js; extend both together.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_form TEXT
  CONSTRAINT tenants_legal_form_check
  CHECK (legal_form IN ('sole_trader', 'partnership', 'company', 'association', 'other'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS directors TEXT;
