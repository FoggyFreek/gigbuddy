CREATE TABLE outreach_suppressions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribed','bounced','complained','manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX outreach_suppressions_uidx ON outreach_suppressions (tenant_id, lower(email));
ALTER TABLE tenants ADD COLUMN outreach_from_name TEXT, ADD COLUMN outreach_from_email TEXT, ADD COLUMN outreach_reply_to TEXT;
