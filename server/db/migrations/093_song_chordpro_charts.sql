-- ChordPro charts: editable lead-sheet source (lyrics + [chords] + {directives})
-- attached to a song. Unlike song_documents/song_recordings (binary blobs in
-- object storage), a chart's source is editable text stored inline, so the
-- in-app editor and viewer can read/write it directly without re-upload.
--
-- Multi-tenant isolation backstop: composite (song_id, tenant_id) FK to
-- songs(id, tenant_id) rejects cross-tenant rows even if a route forgets its
-- WHERE tenant_id.

CREATE TABLE song_chordpro_charts (
  id         SERIAL PRIMARY KEY,
  song_id    INTEGER NOT NULL,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,            -- e.g. "Guitar", "Piano (Bb)"
  source     TEXT NOT NULL DEFAULT '', -- raw ChordPro source
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (song_id, tenant_id) REFERENCES songs(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX song_chordpro_charts_song_idx ON song_chordpro_charts (song_id, tenant_id);
