CREATE TABLE tenant_invites (
  id                  SERIAL PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role                TEXT NOT NULL DEFAULT 'member'
                        CHECK (role IN ('tenant_admin', 'member')),
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at          TIMESTAMPTZ,
  used_by_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_invites_tenant_id ON tenant_invites(tenant_id);
