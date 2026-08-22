CREATE TABLE venue_groups (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (btrim(name) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX venue_groups_tenant_name_uidx
  ON venue_groups (tenant_id, lower(name));

CREATE TABLE venue_group_memberships (
  group_id   INTEGER NOT NULL,
  venue_id   INTEGER NOT NULL,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, group_id, venue_id),
  FOREIGN KEY (group_id, tenant_id)
    REFERENCES venue_groups(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (venue_id, tenant_id)
    REFERENCES venues(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX venue_group_memberships_venue_idx
  ON venue_group_memberships (tenant_id, venue_id);
