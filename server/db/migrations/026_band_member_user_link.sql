-- A user can now belong to multiple tenants and thus be linked to multiple
-- band_member rows (one per tenant). Replace the global UNIQUE(user_id) with
-- a partial UNIQUE on (user_id, tenant_id).

ALTER TABLE band_members DROP CONSTRAINT IF EXISTS band_members_user_id_key;

CREATE UNIQUE INDEX band_members_user_tenant_unique
  ON band_members (user_id, tenant_id)
  WHERE user_id IS NOT NULL;
