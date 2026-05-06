-- Phase 4: replace single-column child FKs with composite FKs against
-- parent (id, tenant_id) so a child row can never reference a parent in a
-- different tenant. The DB rejects cross-tenant joins even if a route
-- handler forgets to filter by tenant_id.

-- gig_tasks: gig_id -> gigs(id, tenant_id), assigned_to -> band_members(id, tenant_id)
ALTER TABLE gig_tasks DROP CONSTRAINT gig_tasks_gig_id_fkey;
ALTER TABLE gig_tasks DROP CONSTRAINT gig_tasks_assigned_to_fkey;

ALTER TABLE gig_tasks
  ADD CONSTRAINT gig_tasks_gig_fkey
    FOREIGN KEY (gig_id, tenant_id)
    REFERENCES gigs(id, tenant_id) ON DELETE CASCADE;

ALTER TABLE gig_tasks
  ADD CONSTRAINT gig_tasks_assigned_fkey
    FOREIGN KEY (assigned_to, tenant_id)
    REFERENCES band_members(id, tenant_id) ON DELETE SET NULL (assigned_to);

-- gig_participants: composite FKs to gigs and band_members
ALTER TABLE gig_participants DROP CONSTRAINT gig_participants_gig_id_fkey;
ALTER TABLE gig_participants DROP CONSTRAINT gig_participants_band_member_id_fkey;

ALTER TABLE gig_participants
  ADD CONSTRAINT gig_participants_gig_fkey
    FOREIGN KEY (gig_id, tenant_id)
    REFERENCES gigs(id, tenant_id) ON DELETE CASCADE;

ALTER TABLE gig_participants
  ADD CONSTRAINT gig_participants_member_fkey
    FOREIGN KEY (band_member_id, tenant_id)
    REFERENCES band_members(id, tenant_id) ON DELETE CASCADE;

-- rehearsal_participants: composite FKs to rehearsals and band_members
ALTER TABLE rehearsal_participants DROP CONSTRAINT rehearsal_participants_rehearsal_id_fkey;
ALTER TABLE rehearsal_participants DROP CONSTRAINT rehearsal_participants_band_member_id_fkey;

ALTER TABLE rehearsal_participants
  ADD CONSTRAINT rehearsal_participants_rehearsal_fkey
    FOREIGN KEY (rehearsal_id, tenant_id)
    REFERENCES rehearsals(id, tenant_id) ON DELETE CASCADE;

ALTER TABLE rehearsal_participants
  ADD CONSTRAINT rehearsal_participants_member_fkey
    FOREIGN KEY (band_member_id, tenant_id)
    REFERENCES band_members(id, tenant_id) ON DELETE CASCADE;

-- availability_slots: composite FK to band_members (nullable: band-wide slots)
ALTER TABLE availability_slots DROP CONSTRAINT availability_slots_band_member_id_fkey;

ALTER TABLE availability_slots
  ADD CONSTRAINT availability_slots_member_fkey
    FOREIGN KEY (band_member_id, tenant_id)
    REFERENCES band_members(id, tenant_id) ON DELETE CASCADE;
