-- Not every band a musician plays in is a gigbuddy customer. Those exist only
-- as a name in the musician's own address book — an 'ensemble' contact — never
-- as a shell tenant: a shell would consume the BANDS cap, appear in admin
-- listings, and have no administrator.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_category_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_category_check
  CHECK (category IN ('press', 'radio & tv', 'booker', 'promotion', 'network', 'supplier', 'ensemble'));

-- Which ensemble a gig was played with. Only meaningful in a personal
-- workspace, where the musician's own gigs live; a band's gigs are already the
-- band's. The composite FK is the DB backstop for tenant isolation — the
-- contact must belong to the same tenant as the gig.
ALTER TABLE gigs
  ADD COLUMN IF NOT EXISTS ensemble_contact_id INTEGER;

ALTER TABLE gigs DROP CONSTRAINT IF EXISTS gigs_ensemble_contact_fk;

-- The column list on SET NULL is load-bearing (PG 15+): without it, deleting a
-- referenced contact would null EVERY column of this composite key — including
-- tenant_id, which is NOT NULL. Losing the ensemble tag is right; losing the
-- gig's tenant is a constraint violation.
ALTER TABLE gigs
  ADD CONSTRAINT gigs_ensemble_contact_fk
    FOREIGN KEY (ensemble_contact_id, tenant_id)
    REFERENCES contacts(id, tenant_id)
    ON DELETE SET NULL (ensemble_contact_id);

CREATE INDEX IF NOT EXISTS idx_gigs_ensemble_contact
  ON gigs (tenant_id, ensemble_contact_id)
  WHERE ensemble_contact_id IS NOT NULL;
