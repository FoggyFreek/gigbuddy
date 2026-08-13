-- Record which country-pack revision configured each existing tenant.
--
-- Migration 176 wrote every tenant's chart-of-accounts default_name from the
-- label registry that revision 2026.1 covers (server/domain/accountNamePacks.js),
-- so that is the ruleset behind their current configuration. New tenants are
-- stamped at profile creation and re-stamped on a country change.
--
-- The stamp format is owned by countryPackVersion() in shared/countryPack.js —
-- keep the two in sync. A later revision gets its own migration that re-applies
-- the widened pack and re-stamps; see that file for the procedure.
--
-- The second predicate supersedes `<cc>-accounts-2026.1`, a pre-release stamp
-- format from an earlier iteration of this work. It was never released, so only
-- a pre-release environment can be holding it.
--
-- Guarded so it is idempotent and never overwrites a newer revision's stamp.

UPDATE tenant_accounting_profiles
   SET pack_version = country_code || '-pack-2026.1',
       updated_at = NOW()
 WHERE pack_version IS NULL
    OR pack_version = country_code || '-accounts-2026.1';
