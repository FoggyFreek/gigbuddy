CREATE TABLE outreach_templates (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  subject TEXT NOT NULL DEFAULT '',
  preview_text TEXT,
  body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  origin_key TEXT,
  locale TEXT NOT NULL DEFAULT 'nl' CHECK (locale IN ('nl', 'en')),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX outreach_templates_tenant_name_uidx ON outreach_templates (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX outreach_templates_id_tenant_uidx ON outreach_templates (id, tenant_id);
