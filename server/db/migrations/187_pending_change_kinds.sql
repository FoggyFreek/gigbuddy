-- pending_change_kind is declared once, in
-- server/commerce/billing/pendingChangeKinds.js. This migration regenerates the
-- CHECK constraints from that same list; adding a kind means editing that file
-- and adding a migration like this one, nothing else.
-- subscriptionModules.test.js asserts the constraint and the JS table agree, so
-- the two cannot drift silently.

ALTER TABLE subscription_modules
  DROP CONSTRAINT IF EXISTS subscription_modules_pending_change_kind_check;
ALTER TABLE subscription_modules
  ADD CONSTRAINT subscription_modules_pending_change_kind_check CHECK (
    pending_change_kind IN ('upgrade','downgrade','remove','trial_selection')
  );

-- A removal names no target plan; every other kind always does.
ALTER TABLE subscription_modules
  DROP CONSTRAINT IF EXISTS subscription_modules_pending_shape;
ALTER TABLE subscription_modules
  ADD CONSTRAINT subscription_modules_pending_shape CHECK (
    (pending_change_kind IS NULL AND pending_plan_id IS NULL AND pending_price_cents IS NULL)
    OR (pending_change_kind = 'remove'
        AND pending_plan_id IS NULL AND pending_price_cents IS NULL)
    OR (pending_change_kind IN ('upgrade','downgrade','trial_selection')
        AND pending_plan_id IS NOT NULL AND pending_price_cents IS NOT NULL)
  );

-- Every kind declared `bindsCapacity` must carry the limits the change was
-- checked against; a trial_selection recorded before that rule existed does
-- not. Migration 183 is unreleased, so these rows only exist in development
-- databases: rebind them from the target plan, with the module's own limit
-- overrides applied on top (the jsonb concat mirrors mergeEntitlements, which
-- lets an override replace a plan limit key for key).
UPDATE subscription_modules m
   SET pending_limits_snapshot =
         COALESCE(p.entitlements -> 'limits', '{}'::jsonb)
         || COALESCE(m.entitlement_overrides -> 'limits', '{}'::jsonb),
       updated_at = NOW()
  FROM subscription_plans p
 WHERE p.id = m.pending_plan_id
   AND m.pending_change_kind = 'trial_selection'
   AND m.pending_limits_snapshot IS NULL;
