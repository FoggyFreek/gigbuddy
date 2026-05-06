-- Add nullable tenant_id to every tenant-owned table.
-- Backfill all existing rows to the seed tenant (id = 1).
-- NOT NULL + composite same-tenant FKs are added in phase 4 (migration 027+).

ALTER TABLE band_members
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE band_members SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_band_members_tenant_id ON band_members(tenant_id);

ALTER TABLE gigs
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE gigs SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_gigs_tenant_id ON gigs(tenant_id);

ALTER TABLE gig_tasks
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE gig_tasks SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_gig_tasks_tenant_id ON gig_tasks(tenant_id);

ALTER TABLE gig_participants
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE gig_participants SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_gig_participants_tenant_id ON gig_participants(tenant_id);

ALTER TABLE rehearsals
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE rehearsals SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_rehearsals_tenant_id ON rehearsals(tenant_id);

ALTER TABLE rehearsal_participants
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE rehearsal_participants SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_rehearsal_participants_tenant_id ON rehearsal_participants(tenant_id);

ALTER TABLE band_events
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE band_events SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_band_events_tenant_id ON band_events(tenant_id);

ALTER TABLE availability_slots
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE availability_slots SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_availability_slots_tenant_id ON availability_slots(tenant_id);

ALTER TABLE venues
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE venues SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_venues_tenant_id ON venues(tenant_id);

ALTER TABLE contacts
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE contacts SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_contacts_tenant_id ON contacts(tenant_id);

ALTER TABLE email_templates
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE email_templates SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_email_templates_tenant_id ON email_templates(tenant_id);

ALTER TABLE share_photos
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE share_photos SET tenant_id = 1 WHERE tenant_id IS NULL;
CREATE INDEX idx_share_photos_tenant_id ON share_photos(tenant_id);
