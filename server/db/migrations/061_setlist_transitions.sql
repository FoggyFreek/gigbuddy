-- Song transitions (segues): a setlist item can be linked to the next item in
-- the same set, with an optional free-text note describing the transition. The
-- link lives on the upper item ("this song segues into the next"). UI only
-- exposes it between two consecutive song items; the columns stay permissive.
ALTER TABLE setlist_items
  ADD COLUMN linked_to_next  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN transition_note TEXT;
