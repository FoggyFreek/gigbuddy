-- Forward index for reverse lookups (contact -> venues/festivals).
-- venue_contacts' existing indexes both lead with venue_id (055), so filtering
-- by contact_id (GET /contacts/:id/venues) would seq-scan as the table grows.
CREATE INDEX venue_contacts_contact_idx ON venue_contacts (contact_id, tenant_id);
