-- Songs linked to rehearsals (what will be practiced).
CREATE TABLE rehearsal_songs (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rehearsal_id INTEGER NOT NULL,
  song_id      INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rehearsal_songs_rehearsal_fk FOREIGN KEY (rehearsal_id, tenant_id)
    REFERENCES rehearsals(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT rehearsal_songs_song_fk FOREIGN KEY (song_id, tenant_id)
    REFERENCES songs(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT rehearsal_songs_unique UNIQUE (tenant_id, rehearsal_id, song_id)
);

CREATE INDEX rehearsal_songs_tenant_rehearsal_idx ON rehearsal_songs (tenant_id, rehearsal_id);
