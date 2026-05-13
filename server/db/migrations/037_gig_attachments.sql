CREATE TABLE gig_attachments (
  id                SERIAL PRIMARY KEY,
  gig_id            INTEGER NOT NULL,
  tenant_id         INTEGER NOT NULL,
  object_key        TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  file_size         INTEGER NOT NULL,
  uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX ON gig_attachments(gig_id, tenant_id);
