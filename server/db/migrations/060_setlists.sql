-- Setlists: ordered sets, each holding ordered items (songs / pauses / breaks).
-- Composite (id, tenant_id) FKs are the tenant-isolation backstop.

CREATE TABLE setlists (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT setlists_id_tenant_id_key UNIQUE (id, tenant_id)
);

CREATE INDEX setlists_tenant_idx ON setlists (tenant_id, name);

CREATE TABLE setlist_sets (
  id               SERIAL PRIMARY KEY,
  setlist_id       INTEGER NOT NULL,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  include_in_total BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT setlist_sets_id_tenant_id_key UNIQUE (id, tenant_id),
  FOREIGN KEY (setlist_id, tenant_id) REFERENCES setlists(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX setlist_sets_setlist_idx ON setlist_sets (setlist_id, tenant_id, sort_order);

CREATE TABLE setlist_items (
  id               SERIAL PRIMARY KEY,
  set_id           INTEGER NOT NULL,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_type        TEXT NOT NULL CHECK (item_type IN ('song', 'pause', 'break')),
  song_id          INTEGER,
  duration_seconds INTEGER,
  label            TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (set_id, tenant_id)  REFERENCES setlist_sets(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (song_id, tenant_id) REFERENCES songs(id, tenant_id)        ON DELETE CASCADE,
  -- Song items reference a song and derive their duration from it (NULL here);
  -- pause/break items carry their own non-negative duration and no song.
  CONSTRAINT setlist_items_shape CHECK (
    (item_type = 'song'  AND song_id IS NOT NULL AND duration_seconds IS NULL) OR
    (item_type IN ('pause', 'break') AND song_id IS NULL
       AND duration_seconds IS NOT NULL AND duration_seconds >= 0)
  )
);

CREATE INDEX setlist_items_set_idx  ON setlist_items (set_id, tenant_id, sort_order);
CREATE INDEX setlist_items_song_idx ON setlist_items (song_id, tenant_id);
