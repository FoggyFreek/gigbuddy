-- Phase 4: parent tables get UNIQUE(id, tenant_id) so child tables can use a
-- composite FK to enforce same-tenant references.
--
-- Adding a UNIQUE on a column that is already a PRIMARY KEY is redundant for
-- uniqueness purposes but is required because PostgreSQL FOREIGN KEY clauses
-- can only reference an explicit unique/primary-key constraint that covers
-- the EXACT column list of the FK. The PK alone (just `id`) doesn't satisfy
-- a FK on `(id, tenant_id)`.

ALTER TABLE tenants
  ADD CONSTRAINT tenants_id_key UNIQUE (id);

ALTER TABLE gigs
  ADD CONSTRAINT gigs_id_tenant_id_key UNIQUE (id, tenant_id);

ALTER TABLE rehearsals
  ADD CONSTRAINT rehearsals_id_tenant_id_key UNIQUE (id, tenant_id);

ALTER TABLE band_members
  ADD CONSTRAINT band_members_id_tenant_id_key UNIQUE (id, tenant_id);
