-- External ensembles are no longer a concept: a band that isn't a gigbuddy
-- customer is an ordinary contact or nothing at all. Reverses migration 162.
-- Dropping the column takes gigs_ensemble_contact_fk and the partial index
-- idx_gigs_ensemble_contact with it.
ALTER TABLE gigs DROP COLUMN IF EXISTS ensemble_contact_id;

-- Every FK into contacts is ON DELETE CASCADE (contact_notes, gig_contacts,
-- venue_contacts) or SET NULL (purchases.supplier_contact_id), so nothing
-- blocks this delete. It must precede the tightened CHECK below.
DELETE FROM contacts WHERE category = 'ensemble';

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_category_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_category_check
  CHECK (category IN ('press', 'radio & tv', 'booker', 'promotion', 'network', 'supplier'));
