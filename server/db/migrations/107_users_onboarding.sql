-- Onboarding support: server-recorded terms acceptance and an explicit
-- pointer to the tenant created during onboarding (the resume marker — never
-- inferred from "any owned tenant", which could adopt an established band).
ALTER TABLE users
  ADD COLUMN terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN terms_version TEXT,
  ADD COLUMN onboarding_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  ADD CONSTRAINT users_terms_pair_check
    CHECK ((terms_accepted_at IS NULL) = (terms_version IS NULL));
