CREATE TABLE memberships (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role                TEXT NOT NULL DEFAULT 'member'
                        CHECK (role IN ('tenant_admin', 'member')),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at         TIMESTAMPTZ,
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, tenant_id)
);

CREATE INDEX idx_memberships_tenant_status ON memberships(tenant_id, status);
CREATE INDEX idx_memberships_user_status   ON memberships(user_id, status);

INSERT INTO memberships (user_id, tenant_id, role, status, created_at, approved_at)
SELECT
  u.id,
  1,
  CASE WHEN u.is_admin THEN 'tenant_admin' ELSE 'member' END,
  u.status,
  u.created_at,
  CASE WHEN u.status = 'approved' THEN COALESCE(u.last_login_at, NOW()) ELSE NULL END
FROM users u
ON CONFLICT (user_id, tenant_id) DO NOTHING;
