-- Tasks were originally always children of a gig (gig_id NOT NULL since 002).
-- They are now first-class: a task may stand alone (gig_id NULL) or stay linked
-- to a gig. The composite FK (gig_id, tenant_id) -> gigs(id, tenant_id) is
-- MATCH SIMPLE, so it goes inert when gig_id is NULL while tenant_id keeps its
-- own independent FK; idx_gig_tasks_gig_id is a plain btree that simply doesn't
-- match NULLs. Deleting a gig still CASCADE-deletes its linked tasks (unchanged).
ALTER TABLE gig_tasks ALTER COLUMN gig_id DROP NOT NULL;
