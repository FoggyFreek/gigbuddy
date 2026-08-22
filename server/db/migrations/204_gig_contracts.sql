CREATE TABLE gig_contracts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gig_id INTEGER NOT NULL,
  reference TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  locale TEXT NOT NULL CHECK (locale IN ('nl', 'en')),
  terms_snapshot JSONB NOT NULL,
  pdf_object_key TEXT,
  pdf_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','countersigned','void')),
  countersigned_at TIMESTAMPTZ,
  countersigned_note TEXT,
  sent_campaign_id INTEGER,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT gig_contracts_countersigned_has_date CHECK (status <> 'countersigned' OR countersigned_at IS NOT NULL)
);
CREATE UNIQUE INDEX gig_contracts_reference_uidx ON gig_contracts (tenant_id, reference);
CREATE UNIQUE INDEX gig_contracts_id_tenant_uidx ON gig_contracts (id, tenant_id);
CREATE INDEX gig_contracts_gig_idx ON gig_contracts (gig_id, tenant_id);
ALTER TABLE outreach_campaigns ADD COLUMN contract_id INTEGER;
ALTER TABLE outreach_campaigns ADD CONSTRAINT outreach_campaigns_contract_fk FOREIGN KEY (contract_id, tenant_id) REFERENCES gig_contracts (id, tenant_id) ON DELETE SET NULL;
ALTER TABLE gig_contracts ADD CONSTRAINT gig_contracts_sent_campaign_fk FOREIGN KEY (sent_campaign_id, tenant_id) REFERENCES outreach_campaigns (id, tenant_id) ON DELETE SET NULL;
