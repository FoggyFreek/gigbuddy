-- Replaces the has_pa_system / has_drumkit / has_stage_lights booleans with a set
-- of catalogue items per gig, each marked as provided by the venue ('event') or
-- brought by the band ('band'). item_key is validated against the code registry
-- in shared/gigEquipment.js, not by a CHECK, so extending the catalogue needs no
-- migration.
CREATE TABLE gig_equipment (
  gig_id    INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_key  TEXT    NOT NULL,
  provider  TEXT    NOT NULL CHECK (provider IN ('event', 'band')),
  PRIMARY KEY (gig_id, item_key),
  FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs(id, tenant_id) ON DELETE CASCADE
);

-- A set boolean meant "the venue has one", so it carries over as 'event'.
INSERT INTO gig_equipment (gig_id, tenant_id, item_key, provider)
SELECT id, tenant_id, 'pa_system', 'event' FROM gigs WHERE has_pa_system
UNION ALL
SELECT id, tenant_id, 'drumkit', 'event' FROM gigs WHERE has_drumkit
UNION ALL
SELECT id, tenant_id, 'stage_lights', 'event' FROM gigs WHERE has_stage_lights;

-- Expand → migrate → contract: the three gigs columns are left in place so the
-- previous app container keeps working while this runs. Dropping them is a
-- follow-up migration in a later deployment.
