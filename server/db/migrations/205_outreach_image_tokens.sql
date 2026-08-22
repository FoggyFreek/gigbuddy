CREATE TABLE outreach_image_tokens (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE CHECK (length(token) >= 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

