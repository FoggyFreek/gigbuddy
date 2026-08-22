-- Gig "Additional information": free-form labelled text blocks on the Tasks tab
-- (timetable, hospitality, technical information, …), replacing the single
-- free-text `gigs.notes` field.
--
-- A label is either one of the canonical keys — translated for display — or
-- text the user typed. `label_is_custom` is the discriminator rather than
-- letting a lookup miss stand in for "this one is custom"; see
-- shared/gigInfoLabels.js, which owns the key list.
--
-- Composite FK is the tenant-isolation backstop; depends on
-- gigs_id_tenant_id_key (028).
CREATE TABLE IF NOT EXISTS gig_info_blocks (
  id              SERIAL PRIMARY KEY,
  gig_id          INTEGER NOT NULL,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  label_is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  content         TEXT NOT NULL DEFAULT '',
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT gig_info_blocks_label_check CHECK (
    label_is_custom OR label IN (
      'remarks', 'timetable', 'hospitality', 'catering', 'technical_information',
      'dressing_room', 'light', 'merchandise', 'backline', 'invoice_info',
      'press', 'guestlist', 'recording'
    )
  ),
  CONSTRAINT gig_info_blocks_custom_label_not_blank CHECK (
    NOT label_is_custom OR btrim(label) <> ''
  )
);

CREATE INDEX IF NOT EXISTS gig_info_blocks_gig_idx ON gig_info_blocks (gig_id, tenant_id);

-- Existing notes become the gig's Remarks block, which is the block every gig
-- shows by default. Only gigs that actually have notes get a row; the rest
-- render an empty Remarks block that materialises on first keystroke.
--
-- The whole file is written to be re-runnable (IF NOT EXISTS above, the NOT
-- EXISTS guard here) so the backfill can be replayed in a test against
-- reconstructed legacy rows, and so a partial run cannot duplicate blocks.
INSERT INTO gig_info_blocks (gig_id, tenant_id, label, label_is_custom, content, position)
SELECT g.id, g.tenant_id, 'remarks', FALSE, g.notes, 0
  FROM gigs g
 WHERE g.notes IS NOT NULL AND btrim(g.notes) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM gig_info_blocks b
      WHERE b.gig_id = g.id AND b.tenant_id = g.tenant_id
   );

-- CONTRACT (a later deployment, once no container reads the old field):
--   ALTER TABLE gigs DROP COLUMN notes;
-- Until then `gigs.notes` is left in place and untouched: the previous app
-- container still serves while this migration runs and may still write it.
