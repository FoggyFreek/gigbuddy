-- Retires the pre-encryption plaintext credential columns. Every value now
-- lives in the matching *_encrypted envelope column; the dual-read fallback
-- and the plaintext drain script are gone with this migration.
ALTER TABLE tenant_integrations
  DROP COLUMN mollie_api_key,
  DROP COLUMN shopify_client_secret,
  DROP COLUMN bandsintown_app_id;
