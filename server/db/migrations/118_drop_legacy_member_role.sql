-- Remove the legacy 'member' role alias entirely. It behaved identically to
-- 'contributor' in application code; backfill existing rows before tightening
-- the CHECK constraints so no row is left violating them.

UPDATE memberships SET role = 'contributor' WHERE role = 'member';
UPDATE tenant_invites SET role = 'contributor' WHERE role = 'member';

ALTER TABLE memberships ALTER COLUMN role SET DEFAULT 'contributor';
ALTER TABLE tenant_invites ALTER COLUMN role SET DEFAULT 'contributor';

ALTER TABLE memberships
  DROP CONSTRAINT memberships_role_check;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('tenant_admin', 'reader', 'contributor', 'financial_admin'));

ALTER TABLE tenant_invites
  DROP CONSTRAINT tenant_invites_role_check;

ALTER TABLE tenant_invites
  ADD CONSTRAINT tenant_invites_role_check
  CHECK (role IN ('tenant_admin', 'reader', 'contributor', 'financial_admin'));
