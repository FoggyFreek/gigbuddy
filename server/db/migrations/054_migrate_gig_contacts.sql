-- Add UNIQUE(id, tenant_id) to contacts to support composite FK from contact_notes
ALTER TABLE contacts
  ADD CONSTRAINT contacts_id_tenant_id_key UNIQUE (id, tenant_id);

-- contact_notes: timestamped notes on a contact, scoped to same tenant via composite FK
CREATE TABLE contact_notes (
  id         SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  note       TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (contact_id, tenant_id) REFERENCES contacts(id, tenant_id) ON DELETE CASCADE
);

-- Upsert booker contacts from gigs; skip blank names; first gig per name wins for email/phone
INSERT INTO contacts (tenant_id, name, email, phone, category)
SELECT DISTINCT ON (g.tenant_id, lower(btrim(g.contact_name)))
  g.tenant_id,
  btrim(g.contact_name)              AS name,
  NULLIF(btrim(g.contact_email), '') AS email,
  NULLIF(btrim(g.contact_phone), '') AS phone,
  'booker'
FROM gigs g
WHERE NULLIF(btrim(g.contact_name), '') IS NOT NULL
ORDER BY g.tenant_id, lower(btrim(g.contact_name)), g.id
ON CONFLICT (tenant_id, lower(name), lower(category)) DO NOTHING;

-- Add a migration note for every gig each booker contact came from
INSERT INTO contact_notes (contact_id, tenant_id, note, created_at)
SELECT
  c.id,
  c.tenant_id,
  'Migrated from gig: ' ||
    COALESCE(g.event_description, '(no title)') ||
    ' on ' || g.event_date::DATE,
  NOW()
FROM gigs g
JOIN contacts c
  ON c.tenant_id = g.tenant_id
 AND lower(c.name) = lower(btrim(g.contact_name))
 AND c.category = 'booker'
WHERE NULLIF(btrim(g.contact_name), '') IS NOT NULL;

-- Drop the now-migrated contact columns from gigs
ALTER TABLE gigs
  DROP COLUMN contact_name,
  DROP COLUMN contact_email,
  DROP COLUMN contact_phone;
