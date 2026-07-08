-- Tenant ownership: the owner's subscription determines the whole tenant's
-- entitlements. Deliberately NO backfill — entitlement enforcement is fully
-- skipped while owner_user_id IS NULL, so legacy tenants keep working until
-- ownership is assigned manually (super-admin action).
ALTER TABLE tenants ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX tenants_owner_user_id_idx ON tenants (owner_user_id);
