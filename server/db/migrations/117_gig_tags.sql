-- Reusable tenant-scoped tags for grouping gigs into tours or other collections.
CREATE TABLE gig_tags (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gig_tags_id_tenant_id_key UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX gig_tags_tenant_lower_name_uidx
  ON gig_tags (tenant_id, lower(name));

CREATE TABLE gig_tag_links (
  gig_id    INTEGER NOT NULL,
  tag_id    INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (gig_id, tag_id),
  FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs(id, tenant_id)    ON DELETE CASCADE,
  FOREIGN KEY (tag_id, tenant_id) REFERENCES gig_tags(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX gig_tag_links_tag_idx ON gig_tag_links (tag_id, tenant_id);
