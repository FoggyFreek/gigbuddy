-- Leftovers from the abandoned "template-authored contracts" design. Migration
-- 206 cleaned up gig_contracts but not these, and 199 was trimmed after it had
-- already been applied, so databases migrated before that edit still carry them.
-- Nothing in the codebase reads any of them; entity_kind is NOT NULL with no
-- default, which broke every template insert on a drifted database.
--
-- IF EXISTS throughout: this is a no-op on a database built from the current 199.
ALTER TABLE outreach_templates DROP COLUMN IF EXISTS entity_kind;
ALTER TABLE outreach_templates DROP COLUMN IF EXISTS attach_contract;
ALTER TABLE outreach_templates DROP COLUMN IF EXISTS kind;
ALTER TABLE outreach_recipients DROP COLUMN IF EXISTS gig_id;
