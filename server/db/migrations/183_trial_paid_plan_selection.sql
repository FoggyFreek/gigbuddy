-- A Gold trial may retain Gold entitlements while the customer selects a lower
-- paid plan (for example Band Silver) for the first scheduled paid period.
-- This is neither an immediate downgrade nor an in-flight paid upgrade, so it
-- gets its own boundary-change kind and carries no purge/limit snapshot.

ALTER TABLE subscription_modules
  DROP CONSTRAINT IF EXISTS subscription_modules_pending_change_kind_check;
ALTER TABLE subscription_modules
  ADD CONSTRAINT subscription_modules_pending_change_kind_check CHECK (
    pending_change_kind IN ('upgrade','downgrade','remove','trial_selection')
  );

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
