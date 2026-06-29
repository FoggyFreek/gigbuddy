ALTER TABLE tenants
  ADD COLUMN mollie_api_key_encrypted JSONB,
  ADD COLUMN mollie_api_key_changed_at TIMESTAMPTZ,
  ADD COLUMN shopify_client_secret_encrypted JSONB,
  ADD COLUMN shopify_client_secret_changed_at TIMESTAMPTZ;

