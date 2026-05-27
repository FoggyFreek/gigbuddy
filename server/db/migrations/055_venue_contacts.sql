-- venue_contacts: many-to-many link between venues and contacts.
-- A venue may have multiple contacts; at most one is flagged primary.
-- Composite FKs are the tenant-isolation backstop: a cross-tenant link is
-- rejected by the DB even if a route forgets its WHERE tenant_id.
-- Depends on venues_id_tenant_id_key (044) and contacts_id_tenant_id_key (054).
CREATE TABLE venue_contacts (
  id          SERIAL PRIMARY KEY,
  venue_id    INTEGER NOT NULL,
  contact_id  INTEGER NOT NULL,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (venue_id, tenant_id)   REFERENCES venues(id, tenant_id)   ON DELETE CASCADE,
  FOREIGN KEY (contact_id, tenant_id) REFERENCES contacts(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (venue_id, contact_id, tenant_id)
);

CREATE INDEX venue_contacts_venue_idx ON venue_contacts (venue_id, tenant_id);

-- At most one primary contact per venue.
CREATE UNIQUE INDEX venue_contacts_one_primary_uidx
  ON venue_contacts (tenant_id, venue_id) WHERE is_primary;
