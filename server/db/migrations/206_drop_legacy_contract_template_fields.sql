-- Migration 204 briefly created template-authored contract columns before
-- contracts became fact-only generated PDFs. Environments that applied that
-- earlier draft still require body_html, while fresh databases never had it.
-- Reconcile both shapes with the current gig_contracts schema.
ALTER TABLE gig_contracts
  DROP COLUMN IF EXISTS template_id,
  DROP COLUMN IF EXISTS body_html;
