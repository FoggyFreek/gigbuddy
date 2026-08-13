-- Personal workspaces expose one artist identity through the shared
-- band_members model, without exposing band roster management.

-- Preserve one deterministic row when unexpected legacy data exists. Active,
-- owner-linked rows win; extra active rows are soft-deleted so event history is
-- retained.
WITH keepers AS (
  SELECT DISTINCT ON (t.id) t.id AS tenant_id, bm.id AS member_id
    FROM tenants t
    JOIN band_members bm ON bm.tenant_id = t.id
   WHERE t.kind = 'personal'
   ORDER BY t.id,
            (bm.deleted_at IS NULL AND bm.user_id = t.owner_user_id) DESC,
            (bm.deleted_at IS NULL) DESC,
            bm.id ASC
)
UPDATE band_members bm
   SET deleted_at = COALESCE(bm.deleted_at, NOW())
  FROM tenants t, keepers k
 WHERE t.id = bm.tenant_id
   AND t.kind = 'personal'
   AND k.tenant_id = t.id
   AND bm.id <> k.member_id
   AND bm.deleted_at IS NULL;

WITH keepers AS (
  SELECT DISTINCT ON (t.id) t.id AS tenant_id, t.owner_user_id,
         COALESCE(NULLIF(t.display_name, ''), NULLIF(t.band_name, ''), u.name, 'My workspace') AS member_name,
         bm.id AS member_id
    FROM tenants t
    JOIN users u ON u.id = t.owner_user_id
    JOIN band_members bm ON bm.tenant_id = t.id
   WHERE t.kind = 'personal'
   ORDER BY t.id,
            (bm.deleted_at IS NULL AND bm.user_id = t.owner_user_id) DESC,
            (bm.deleted_at IS NULL) DESC,
            bm.id ASC
)
UPDATE band_members bm
   SET name = k.member_name,
       roles = COALESCE(bm.roles, ARRAY[]::TEXT[]),
       color = NULL,
       sort_order = 0,
       position = 'lead',
       user_id = k.owner_user_id,
       deleted_at = NULL
  FROM keepers k
 WHERE bm.id = k.member_id;

INSERT INTO band_members (tenant_id, name, roles, color, sort_order, position, user_id)
SELECT t.id,
       COALESCE(NULLIF(t.display_name, ''), NULLIF(t.band_name, ''), u.name, 'My workspace'),
       ARRAY[]::TEXT[], NULL, 0, 'lead', t.owner_user_id
  FROM tenants t
  JOIN users u ON u.id = t.owner_user_id
 WHERE t.kind = 'personal'
   AND NOT EXISTS (
     SELECT 1 FROM band_members bm
     WHERE bm.tenant_id = t.id AND bm.deleted_at IS NULL
   );

-- The fixed member is the personal workspace's one participant in every event.
INSERT INTO gig_participants (tenant_id, gig_id, band_member_id, vote, updated_by_user_id)
SELECT g.tenant_id, g.id, bm.id, 'yes', t.owner_user_id
  FROM gigs g
  JOIN tenants t ON t.id = g.tenant_id AND t.kind = 'personal'
  JOIN band_members bm ON bm.tenant_id = t.id AND bm.deleted_at IS NULL
ON CONFLICT (gig_id, band_member_id) DO NOTHING;

INSERT INTO rehearsal_participants
  (tenant_id, rehearsal_id, band_member_id, vote, updated_by_user_id)
SELECT r.tenant_id, r.id, bm.id, 'yes', t.owner_user_id
  FROM rehearsals r
  JOIN tenants t ON t.id = r.tenant_id AND t.kind = 'personal'
  JOIN band_members bm ON bm.tenant_id = t.id AND bm.deleted_at IS NULL
ON CONFLICT (rehearsal_id, band_member_id) DO NOTHING;

INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
SELECT event.tenant_id, event.id, bm.id
  FROM band_events event
  JOIN tenants t ON t.id = event.tenant_id AND t.kind = 'personal'
  JOIN band_members bm ON bm.tenant_id = t.id AND bm.deleted_at IS NULL
ON CONFLICT (band_event_id, band_member_id) DO NOTHING;

CREATE OR REPLACE FUNCTION guard_personal_tenant_member()
RETURNS TRIGGER AS $$
DECLARE
  target_tenant_id INTEGER;
  source_tenant_kind TEXT;
  tenant_kind TEXT;
  tenant_owner_id INTEGER;
  tenant_member_name TEXT;
  other_active_count INTEGER;
BEGIN
  target_tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;

  -- Moving the fixed row out would bypass a check that only inspected the new
  -- tenant. Probe kind without a row lock so band roster writes never
  -- serialize on tenants; only a personal source joins the lock protocol.
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    SELECT kind
      INTO source_tenant_kind
      FROM tenants
     WHERE id = OLD.tenant_id;
    IF FOUND AND source_tenant_kind = 'personal' THEN
      SELECT kind
        INTO source_tenant_kind
        FROM tenants
       WHERE id = OLD.tenant_id
       FOR UPDATE;
      IF FOUND AND source_tenant_kind = 'personal' THEN
        RAISE EXCEPTION 'personal tenant % must keep its fixed owner member', OLD.tenant_id
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  SELECT kind
    INTO tenant_kind
    FROM tenants
   WHERE id = target_tenant_id;

  -- The parent row is no longer visible while its ON DELETE CASCADE runs. Band
  -- members need no personal invariant and deliberately take no tenant lock.
  IF NOT FOUND OR tenant_kind <> 'personal' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT kind, owner_user_id,
         COALESCE(NULLIF(display_name, ''), NULLIF(band_name, ''), 'My workspace')
    INTO tenant_kind, tenant_owner_id, tenant_member_name
    FROM tenants
   WHERE id = target_tenant_id
   FOR UPDATE;

  -- Re-check after acquiring the lock in case kind changed after the probe.
  IF NOT FOUND OR tenant_kind <> 'personal' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE'
     OR NEW.deleted_at IS NOT NULL
     OR NEW.user_id IS DISTINCT FROM tenant_owner_id
     OR NEW.name IS DISTINCT FROM tenant_member_name
     OR NEW.color IS NOT NULL
     OR NEW.sort_order IS DISTINCT FROM 0
     OR NEW.position IS DISTINCT FROM 'lead' THEN
    RAISE EXCEPTION 'personal tenant % must keep its fixed owner member', target_tenant_id
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::INTEGER
    INTO other_active_count
    FROM band_members
   WHERE tenant_id = target_tenant_id
     AND deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF other_active_count > 0 THEN
    RAISE EXCEPTION 'personal tenant % cannot have more than one active member', target_tenant_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personal_tenant_member_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON band_members
  FOR EACH ROW EXECUTE FUNCTION guard_personal_tenant_member();

CREATE OR REPLACE FUNCTION ensure_personal_tenant_member()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
  fixed_member_id INTEGER;
  member_name TEXT;
BEGIN
  IF NEW.kind <> 'personal' THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'personal tenant % must have an owner', NEW.id
      USING ERRCODE = '23514';
  END IF;

  member_name := COALESCE(NULLIF(NEW.display_name, ''), NULLIF(NEW.band_name, ''), 'My workspace');
  SELECT COUNT(*)::INTEGER INTO active_count
    FROM band_members WHERE tenant_id = NEW.id AND deleted_at IS NULL;

  IF active_count = 0 THEN
    INSERT INTO band_members (tenant_id, name, roles, color, sort_order, position, user_id)
    VALUES (NEW.id, member_name, ARRAY[]::TEXT[], NULL, 0, 'lead', NEW.owner_user_id);
  ELSIF active_count = 1 THEN
    UPDATE band_members
       SET name = member_name,
           color = NULL,
           sort_order = 0,
           position = 'lead',
           user_id = NEW.owner_user_id,
           deleted_at = NULL
     WHERE tenant_id = NEW.id AND deleted_at IS NULL;
  ELSE
    RAISE EXCEPTION 'personal tenant % cannot have more than one active member', NEW.id
      USING ERRCODE = '23514';
  END IF;

  SELECT id INTO fixed_member_id
    FROM band_members
   WHERE tenant_id = NEW.id AND deleted_at IS NULL;

  INSERT INTO gig_participants (tenant_id, gig_id, band_member_id, vote, updated_by_user_id)
  SELECT NEW.id, g.id, fixed_member_id, 'yes', NEW.owner_user_id
    FROM gigs g WHERE g.tenant_id = NEW.id
  ON CONFLICT (gig_id, band_member_id) DO NOTHING;

  INSERT INTO rehearsal_participants
    (tenant_id, rehearsal_id, band_member_id, vote, updated_by_user_id)
  SELECT NEW.id, r.id, fixed_member_id, 'yes', NEW.owner_user_id
    FROM rehearsals r WHERE r.tenant_id = NEW.id
  ON CONFLICT (rehearsal_id, band_member_id) DO NOTHING;

  INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
  SELECT NEW.id, event.id, fixed_member_id
    FROM band_events event WHERE event.tenant_id = NEW.id
  ON CONFLICT (band_event_id, band_member_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personal_tenant_member_ensure_trg
  AFTER INSERT OR UPDATE OF kind, owner_user_id, display_name, band_name ON tenants
  FOR EACH ROW EXECUTE FUNCTION ensure_personal_tenant_member();

CREATE OR REPLACE FUNCTION assert_personal_tenant_member()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
  owner_count INTEGER;
BEGIN
  IF NEW.kind <> 'personal' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::INTEGER,
         COUNT(*) FILTER (WHERE user_id = NEW.owner_user_id)::INTEGER
    INTO active_count, owner_count
    FROM band_members
   WHERE tenant_id = NEW.id AND deleted_at IS NULL;

  IF active_count <> 1 OR owner_count <> 1 THEN
    RAISE EXCEPTION 'personal tenant % must have exactly one active owner-linked member', NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER personal_tenant_member_required_trg
  AFTER INSERT OR UPDATE ON tenants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_personal_tenant_member();
