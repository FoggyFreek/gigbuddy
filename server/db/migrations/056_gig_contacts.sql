-- gig_contacts: many-to-many link between gigs and contacts (mirrors venue_contacts).
-- A gig may have multiple contacts; at most one is flagged primary.
-- Composite FKs are the tenant-isolation backstop: a cross-tenant link is
-- rejected by the DB even if a route forgets its WHERE tenant_id.
-- Depends on gigs_id_tenant_id_key (028) and contacts_id_tenant_id_key (054).
CREATE TABLE gig_contacts (
  id          SERIAL PRIMARY KEY,
  gig_id      INTEGER NOT NULL,
  contact_id  INTEGER NOT NULL,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (gig_id, tenant_id)     REFERENCES gigs(id, tenant_id)     ON DELETE CASCADE,
  FOREIGN KEY (contact_id, tenant_id) REFERENCES contacts(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (gig_id, contact_id, tenant_id)
);

CREATE INDEX gig_contacts_gig_idx ON gig_contacts (gig_id, tenant_id);

-- At most one primary contact per gig.
CREATE UNIQUE INDEX gig_contacts_one_primary_uidx
  ON gig_contacts (tenant_id, gig_id) WHERE is_primary;
