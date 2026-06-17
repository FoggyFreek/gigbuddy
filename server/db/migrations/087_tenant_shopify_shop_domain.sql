-- Shopify store domain per tenant. Needed (alongside shopify_api_key, 086) to
-- address the Admin REST API host: https://{shopify_shop_domain}/admin/api/...
-- Non-secret, so unlike the API key it is returned in profile/config payloads.
ALTER TABLE tenants ADD COLUMN shopify_shop_domain TEXT;
