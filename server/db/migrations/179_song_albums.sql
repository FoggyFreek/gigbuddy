-- Tenant-owned album catalogue. Songs may reference one album from the same
-- tenant; the composite foreign key is the database backstop for isolation.

CREATE TABLE albums (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  release_date DATE,
  album_art_url TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT albums_id_tenant_id_key UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX albums_tenant_lower_title_uidx
  ON albums (tenant_id, lower(title));

ALTER TABLE songs ADD COLUMN album_id INTEGER;

ALTER TABLE songs ADD CONSTRAINT songs_album_fk
  FOREIGN KEY (album_id, tenant_id) REFERENCES albums(id, tenant_id);

CREATE INDEX songs_tenant_album_idx ON songs (tenant_id, album_id);
