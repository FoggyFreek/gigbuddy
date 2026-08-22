CREATE TABLE outreach_campaigns (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id INTEGER,
  subject_snapshot TEXT NOT NULL,
  body_html_snapshot TEXT NOT NULL,
  body_text_snapshot TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','partial','failed')),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  FOREIGN KEY (template_id, tenant_id) REFERENCES outreach_templates (id, tenant_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX outreach_campaigns_id_tenant_uidx ON outreach_campaigns (id, tenant_id);
CREATE TABLE outreach_recipients (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL,
  contact_id INTEGER,
  venue_id INTEGER,
  to_email TEXT NOT NULL,
  to_name TEXT,
  merged_subject TEXT NOT NULL,
  resolved_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  provider_message_id TEXT,
  error_message TEXT,
  idempotency_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (campaign_id, tenant_id) REFERENCES outreach_campaigns (id, tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX outreach_recipients_idempotency_uidx ON outreach_recipients (tenant_id, idempotency_key);
CREATE INDEX outreach_recipients_campaign_idx ON outreach_recipients (campaign_id, tenant_id);
