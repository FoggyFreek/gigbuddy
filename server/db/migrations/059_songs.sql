-- Repertoire: the band's song library.
-- Multi-tenant isolation backstop: every parent carries UNIQUE(id, tenant_id) and
-- children reference it with composite (child_id, tenant_id) FKs, so the DB rejects
-- cross-tenant rows even if a route forgets its WHERE tenant_id.

CREATE TABLE songs (
  id               SERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  artist           TEXT,
  song_key         TEXT,                -- "key" is awkward in SQL; use song_key
  tempo            INTEGER,             -- BPM
  duration_seconds INTEGER,
  lyrics_html      TEXT,                -- Tiptap HTML, like email_templates.body_html
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT songs_id_tenant_id_key UNIQUE (id, tenant_id)
);

CREATE INDEX songs_tenant_title_idx ON songs (tenant_id, title);

-- Normalized tags: enables global "search or add new" autocomplete across the band's
-- whole library and consistent renaming.
CREATE TABLE song_tags (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT song_tags_id_tenant_id_key UNIQUE (id, tenant_id)
);

-- Case-insensitive dedupe per tenant. Table constraints can't hold expressions, so
-- this is a separate unique index (same pattern as 031_venues_contacts_tenant_unique).
CREATE UNIQUE INDEX song_tags_tenant_lower_name_uidx
  ON song_tags (tenant_id, lower(name));

CREATE TABLE song_tag_links (
  song_id   INTEGER NOT NULL,
  tag_id    INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (song_id, tag_id),
  FOREIGN KEY (song_id, tenant_id) REFERENCES songs(id, tenant_id)     ON DELETE CASCADE,
  FOREIGN KEY (tag_id, tenant_id)  REFERENCES song_tags(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX song_tag_links_tag_idx ON song_tag_links (tag_id, tenant_id);

CREATE TABLE song_links (
  id         SERIAL PRIMARY KEY,
  song_id    INTEGER NOT NULL,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label      TEXT,
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (song_id, tenant_id) REFERENCES songs(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX song_links_song_idx ON song_links (song_id, tenant_id, sort_order);

-- PDF documents (sheet music etc). Mirrors gig_attachments.
CREATE TABLE song_documents (
  id                SERIAL PRIMARY KEY,
  song_id           INTEGER NOT NULL,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_key        TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  file_size         INTEGER NOT NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (song_id, tenant_id) REFERENCES songs(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX song_documents_song_idx ON song_documents (song_id, tenant_id);

-- mp3 recordings.
CREATE TABLE song_recordings (
  id                SERIAL PRIMARY KEY,
  song_id           INTEGER NOT NULL,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_key        TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  file_size         INTEGER NOT NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (song_id, tenant_id) REFERENCES songs(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX song_recordings_song_idx ON song_recordings (song_id, tenant_id);
