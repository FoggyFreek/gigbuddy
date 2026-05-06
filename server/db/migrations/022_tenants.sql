CREATE TABLE tenants (
  id                  SERIAL PRIMARY KEY,
  slug                TEXT UNIQUE NOT NULL,
  band_name           TEXT,
  bio                 TEXT,
  instagram_handle    TEXT,
  facebook_handle     TEXT,
  tiktok_handle       TEXT,
  youtube_handle      TEXT,
  spotify_handle      TEXT,
  logo_path           TEXT,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tenants (
  id, slug, band_name, bio,
  instagram_handle, facebook_handle, tiktok_handle, youtube_handle, spotify_handle,
  logo_path, created_at, updated_at
)
SELECT
  1, 'seed', band_name, bio,
  instagram_handle, facebook_handle, tiktok_handle, youtube_handle, spotify_handle,
  logo_path, created_at, updated_at
FROM profile
WHERE id = 1
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('tenants', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM tenants), 1)
);

ALTER TABLE profile_links
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE profile_links SET tenant_id = profile_id WHERE tenant_id IS NULL;

CREATE INDEX idx_profile_links_tenant_id ON profile_links(tenant_id);
