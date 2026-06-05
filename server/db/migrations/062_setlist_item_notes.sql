-- Per-band-member notes on a setlist song. Each note is personal to a user and
-- tied to a single setlist_items row (one song at one position in one set), so the
-- same song-in-set carries a separate note for every member.

-- Composite-FK backstop target for child rows (matches setlists/setlist_sets).
ALTER TABLE setlist_items
  ADD CONSTRAINT setlist_items_id_tenant_id_key UNIQUE (id, tenant_id);

-- One personal note per (setlist item, user). Tenant-scoped via composite FK so a
-- forgotten WHERE can't leak across bands. Cascades when the item or user is removed.
CREATE TABLE setlist_item_notes (
  id               SERIAL PRIMARY KEY,
  setlist_item_id  INTEGER NOT NULL,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  note             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (setlist_item_id, tenant_id)
    REFERENCES setlist_items(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT setlist_item_notes_item_user_key UNIQUE (setlist_item_id, user_id)
);

CREATE INDEX setlist_item_notes_item_idx ON setlist_item_notes (setlist_item_id, tenant_id);
