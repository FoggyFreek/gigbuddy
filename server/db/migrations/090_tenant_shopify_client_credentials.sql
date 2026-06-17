-- Shopify access tokens are now minted programmatically via the client_credentials
-- grant (POST /admin/oauth/access_token), so we store the app's Client ID + secret
-- instead of a pasted Admin API token. The value previously held in
-- shopify_api_key was the app secret, so rename it (preserving any entered value)
-- and add the Client ID.
ALTER TABLE tenants RENAME COLUMN shopify_api_key TO shopify_client_secret;
ALTER TABLE tenants ADD COLUMN shopify_client_id TEXT;
