-- Phase 4: enforce tenant_id NOT NULL on every tenant-owned table.
-- Phase 1 backfilled all rows to seed tenant; this migration locks it in.

DO $$
DECLARE
  tbls TEXT[] := ARRAY[
    'band_members', 'gigs', 'gig_tasks', 'gig_participants',
    'rehearsals', 'rehearsal_participants',
    'band_events', 'availability_slots',
    'venues', 'contacts', 'email_templates', 'share_photos',
    'profile_links'
  ];
  t TEXT;
  null_count INTEGER;
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id IS NULL', t)
      INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Cannot set NOT NULL on %.tenant_id: % rows have NULL', t, null_count;
    END IF;
  END LOOP;
END $$;

ALTER TABLE band_members            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE gigs                    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE gig_tasks               ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE gig_participants        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rehearsals              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rehearsal_participants  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE band_events             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE availability_slots      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE venues                  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contacts                ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE email_templates         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE share_photos            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE profile_links           ALTER COLUMN tenant_id SET NOT NULL;
