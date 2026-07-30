CREATE TABLE tenant_integrations (
  tenant_id                           INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  bandsintown_artist_name             TEXT,
  bandsintown_artist_id               TEXT,
  bandsintown_app_id                  TEXT,
  bandsintown_app_id_encrypted        JSONB,
  bandsintown_app_id_changed_at       TIMESTAMPTZ,
  shopify_client_id                   TEXT,
  shopify_client_secret               TEXT,
  shopify_client_secret_encrypted     JSONB,
  shopify_client_secret_changed_at    TIMESTAMPTZ,
  shopify_shop_domain                 TEXT,
  mollie_api_key                      TEXT,
  mollie_api_key_encrypted            JSONB,
  mollie_api_key_changed_at           TIMESTAMPTZ,
  mollie_api_key_retained_at          TIMESTAMPTZ,
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tenant_integrations (
  tenant_id,
  bandsintown_artist_name,
  bandsintown_artist_id,
  bandsintown_app_id,
  bandsintown_app_id_encrypted,
  bandsintown_app_id_changed_at,
  shopify_client_id,
  shopify_client_secret,
  shopify_client_secret_encrypted,
  shopify_client_secret_changed_at,
  shopify_shop_domain,
  mollie_api_key,
  mollie_api_key_encrypted,
  mollie_api_key_changed_at,
  mollie_api_key_retained_at,
  updated_at
)
SELECT
  id,
  bandsintown_artist_name,
  bandsintown_artist_id,
  bandsintown_app_id,
  bandsintown_app_id_encrypted,
  bandsintown_app_id_changed_at,
  shopify_client_id,
  shopify_client_secret,
  shopify_client_secret_encrypted,
  shopify_client_secret_changed_at,
  shopify_shop_domain,
  mollie_api_key,
  mollie_api_key_encrypted,
  mollie_api_key_changed_at,
  mollie_api_key_retained_at,
  updated_at
FROM tenants
WHERE bandsintown_artist_name IS NOT NULL
   OR bandsintown_artist_id IS NOT NULL
   OR bandsintown_app_id IS NOT NULL
   OR bandsintown_app_id_encrypted IS NOT NULL
   OR bandsintown_app_id_changed_at IS NOT NULL
   OR shopify_client_id IS NOT NULL
   OR shopify_client_secret IS NOT NULL
   OR shopify_client_secret_encrypted IS NOT NULL
   OR shopify_client_secret_changed_at IS NOT NULL
   OR shopify_shop_domain IS NOT NULL
   OR mollie_api_key IS NOT NULL
   OR mollie_api_key_encrypted IS NOT NULL
   OR mollie_api_key_changed_at IS NOT NULL
   OR mollie_api_key_retained_at IS NOT NULL;

CREATE TABLE dashboard_tiles (
  tile_id       SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('memory_tile')),
  image_path    TEXT,
  caption       TEXT,
  gig_id        INTEGER REFERENCES gigs(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, type)
);

INSERT INTO dashboard_tiles (tenant_id, type, image_path, caption, gig_id, updated_at)
SELECT id, 'memory_tile', memory_image_path, memory_caption, memory_gig_id, updated_at
FROM tenants
WHERE memory_image_path IS NOT NULL
   OR memory_caption IS NOT NULL
   OR memory_gig_id IS NOT NULL;

ALTER TABLE tenants
  DROP COLUMN bandsintown_artist_name,
  DROP COLUMN bandsintown_artist_id,
  DROP COLUMN bandsintown_app_id,
  DROP COLUMN bandsintown_app_id_encrypted,
  DROP COLUMN bandsintown_app_id_changed_at,
  DROP COLUMN shopify_client_id,
  DROP COLUMN shopify_client_secret,
  DROP COLUMN shopify_client_secret_encrypted,
  DROP COLUMN shopify_client_secret_changed_at,
  DROP COLUMN shopify_shop_domain,
  DROP COLUMN mollie_api_key,
  DROP COLUMN mollie_api_key_encrypted,
  DROP COLUMN mollie_api_key_changed_at,
  DROP COLUMN mollie_api_key_retained_at,
  DROP COLUMN memory_image_path,
  DROP COLUMN memory_caption,
  DROP COLUMN memory_gig_id;
