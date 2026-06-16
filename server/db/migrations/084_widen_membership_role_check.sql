-- Widen the membership/invite role CHECK constraints to allow the three new
-- tenant roles: reader, contributor, financial_admin. The legacy `member` role
-- stays valid and behaves as `contributor` in application code (no backfill).

ALTER TABLE memberships
  DROP CONSTRAINT memberships_role_check;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('tenant_admin', 'member', 'reader', 'contributor', 'financial_admin'));

ALTER TABLE tenant_invites
  DROP CONSTRAINT tenant_invites_role_check;

ALTER TABLE tenant_invites
  ADD CONSTRAINT tenant_invites_role_check
  CHECK (role IN ('tenant_admin', 'member', 'reader', 'contributor', 'financial_admin'));
