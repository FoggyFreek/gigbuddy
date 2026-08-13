-- Performance sources: a setlist item can point at one of the song's ChordPro
-- charts or one of its PDF documents, so performance mode knows what to show for
-- that song in this setlist. The assignment is per setlist item, never per song.
--
-- Two nullable, mutually exclusive references rather than a NOT NULL kind
-- discriminator: ON DELETE SET NULL then self-heals when a chart or document is
-- deleted (the setlist row survives with no source), which a discriminator +
-- CHECK could not — the delete would fail on a constraint violation. Single
-- column FKs rather than the usual composite (id, tenant_id), because a
-- composite FK cannot SET NULL without nulling the NOT NULL tenant_id, and
-- CASCADE would wrongly delete the setlist row. Tenant + song ownership is
-- enforced on the (single) write path in setlistService and re-asserted on every
-- read by joining on tenant_id.
ALTER TABLE setlist_items
  ADD COLUMN chart_id    INTEGER REFERENCES song_chordpro_charts(id) ON DELETE SET NULL,
  ADD COLUMN document_id INTEGER REFERENCES song_documents(id)       ON DELETE SET NULL,
  ADD CONSTRAINT setlist_items_single_source CHECK (chart_id IS NULL OR document_id IS NULL);

CREATE INDEX setlist_items_chart_idx    ON setlist_items (chart_id)    WHERE chart_id IS NOT NULL;
CREATE INDEX setlist_items_document_idx ON setlist_items (document_id) WHERE document_id IS NOT NULL;
