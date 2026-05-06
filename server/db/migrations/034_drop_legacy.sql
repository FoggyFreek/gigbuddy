-- Phase 8: drop legacy single-band columns/tables now that the multi-tenant
-- model owns all reads/writes. profile_links has been tenant-scoped since
-- migration 022; profile.id=1 has been read-only since the routes switched
-- to reading from `tenants` in Phase 3.

ALTER TABLE users DROP COLUMN is_admin;

ALTER TABLE profile_links DROP COLUMN profile_id;

DROP TABLE profile;
