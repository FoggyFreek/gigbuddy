ALTER TABLE tenant_integrations
  ADD COLUMN resend_api_key_encrypted JSONB,
  ADD COLUMN resend_api_key_changed_at TIMESTAMPTZ;
