CREATE TABLE IF NOT EXISTS platform_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  tenant_onboarding_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO platform_settings (id, tenant_onboarding_enabled)
VALUES (TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;
