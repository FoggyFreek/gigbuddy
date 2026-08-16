-- One subscription per user, holding N modules.
--
-- Before this migration a user held one `subscriptions` row per audience: two
-- independent products, each with its own plan, price, trial, Mollie schedule
-- and renewal payment. The commercial model is one customer, one trial, one
-- cycle, one renewal payment — band and artist sold as MODULES of a single
-- subscription, priced together and discounted as a bundle.
--
-- `audience` survives as the module key; what ends is "a *subscription* is
-- bound to one audience". Everything that was genuinely per-audience —
-- entitlement overrides, the downgrade purge manifest, the limits snapshot,
-- a pending plan change — moves onto the module row. That move is load-bearing,
-- not cosmetic: an artist downgrade's `bands: 0` limits snapshot must never
-- zero the owner's band cap.
--
-- Applied as one migration, dropping the legacy columns in the same file,
-- because no user holds a live PAID subscription: no revenue to protect. The
-- one residual risk is the deploy window itself — deploys migrate while the
-- PREVIOUS container still serves, and that container's /api/billing queries
-- join subscriptions.plan_id, so they 500 until the new container takes over.
-- With paying customers this would have to be two deploys (expand, then
-- contract) instead.
--
-- "No paid subscribers" is NOT the same as "the table is empty": a
-- complimentary grant costs nothing and is exactly the row an admin creates by
-- hand, which is how a development database ended up with eleven of them. The
-- legacy section below therefore does the work instead of assuming it away —
-- it normalizes what has an exact equivalent, back-fills a module for every
-- live subscription, and REFUSES to migrate the shapes that have no honest
-- representation, in the style of migration 166's preflight. Dropping
-- plan_id/price_cents/audience out from under a surviving row would otherwise
-- leave a live subscription that owns no module: it grants nothing, yet still
-- occupies the user's one live slot and blocks the trial.

-- ------------------------------------------------------------------ plans ----

-- Which plan a free trial grants on each ladder. Resolved by flag and never by
-- slug: slugs are admin-editable and have already drifted once in the field
-- (migration 166's header records 'artistgold'). Keep server/db/defaultPlans.js
-- in step.
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS is_trial_tier BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_single_trial_tier_per_audience_idx
  ON subscription_plans (audience) WHERE is_trial_tier;

-- The trial is Gold-only on both ladders. Keyed on the seeded slugs, INCLUDING
-- the drift this catalog is known to carry: migration 160 seeded 'artist_gold',
-- but isValidSlug rejects the underscore, so the tier was hand-renamed to
-- 'artistgold' in at least one database (see planValidators.js). Keying on the
-- pristine slug alone silently leaves that ladder with no trial tier at all,
-- and every artist trial then 409s `trial_tier_missing` — a broken acquisition
-- funnel that no deploy step would have reported.
--
-- DISTINCT ON keeps this single-valued per audience whatever the catalog holds:
-- a database carrying BOTH spellings designates one, rather than tripping
-- subscription_plans_single_trial_tier_per_audience_idx with an error that
-- names an index instead of the problem. Inactive plans are never eligible —
-- fetchTrialTierPlan filters on is_active, so designating one would be the same
-- silent nothing.
WITH designated AS (
  SELECT DISTINCT ON (audience) id
    FROM subscription_plans
   WHERE is_active AND NOT is_fallback
     AND slug IN ('gold', 'artist_gold', 'artistgold')
   ORDER BY audience, sort_order DESC, id
)
UPDATE subscription_plans p
   SET is_trial_tier = TRUE, updated_at = NOW()
  FROM designated d
 WHERE p.id = d.id;

-- Postcondition, deliberately fatal. The alternative to failing here is
-- shipping a ladder whose trial cannot start, discovered by a customer. This
-- never guesses a tier — designating "the most expensive plan" would risk
-- granting the wrong product for the rest of the trial — it stops and asks for
-- a human decision, which is one UPDATE followed by a redeploy. A ladder that
-- sells nothing but its free floor needs no trial tier and is not required to
-- have one.
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(DISTINCT p.audience, ', ' ORDER BY p.audience) INTO missing
    FROM subscription_plans p
   WHERE p.is_active AND NOT p.is_fallback
     AND NOT EXISTS (
       SELECT 1 FROM subscription_plans t
        WHERE t.audience = p.audience AND t.is_trial_tier AND t.is_active);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'no trial tier could be designated for audience(s) %. The seeded slugs are '
      'gone from this catalog; pick the tier the free trial should grant and set '
      'is_trial_tier on it (one active, non-fallback plan per audience), then '
      'redeploy.', missing;
  END IF;
END $$;

-- ----------------------------------------------------------------- modules ----

CREATE TABLE IF NOT EXISTS subscription_modules (
  id                     SERIAL PRIMARY KEY,
  subscription_id        INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  -- Derived from the plan on INSERT and immutable thereafter (see the triggers
  -- below). A module is bound to its ladder for life, exactly as a whole
  -- subscription used to be.
  audience               TEXT NOT NULL CHECK (audience IN ('band','artist')),
  plan_id                INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  -- The explicit discriminator for what this module grants RIGHT NOW:
  --   pending         — bought, awaiting its (prorated) charge; grants nothing
  --   active          — grants its plan's entitlements
  --   pending_removal — still grants, until the period boundary drops it
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('pending','active','pending_removal')),
  -- List price for the subscription's interval at the time the module was
  -- bought or last changed. The discounted total lives in the price snapshot.
  price_cents            INTEGER NOT NULL CHECK (price_cents >= 0),
  -- The module the trial started with. A second module added during a trial is
  -- free but does not extend it.
  is_starter             BOOLEAN NOT NULL DEFAULT FALSE,
  -- Per-module, not per-subscription: an override belongs to one ladder's
  -- entitlements and must not leak into the other's.
  entitlement_overrides  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- A scheduled change to THIS module. An upgrade lands when its prorated
  -- charge is paid; a downgrade or removal lands at the period boundary.
  pending_plan_id        INTEGER REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  pending_change_kind    TEXT CHECK (pending_change_kind IN ('upgrade','downgrade','remove')),
  pending_price_cents    INTEGER CHECK (pending_price_cents >= 0),
  -- Frozen at downgrade confirmation, consumed when the target plan becomes
  -- real. The snapshot binds capacity growth immediately via the resolver; the
  -- manifest can only ever SHRINK between confirmation and execution.
  pending_purge_manifest JSONB,
  pending_limits_snapshot JSONB,
  downgrade_confirmed_at TIMESTAMPTZ,
  added_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A removal names no target plan; an upgrade or downgrade always does.
  CONSTRAINT subscription_modules_pending_shape CHECK (
    (pending_change_kind IS NULL AND pending_plan_id IS NULL AND pending_price_cents IS NULL)
    OR (pending_change_kind = 'remove'
        AND pending_plan_id IS NULL AND pending_price_cents IS NULL)
    OR (pending_change_kind IN ('upgrade','downgrade')
        AND pending_plan_id IS NOT NULL AND pending_price_cents IS NOT NULL)
  ),
  -- Status and scheduled change are two views of one fact; tie them together
  -- so neither can drift out from under the other. Both sides are made
  -- NULL-free first: a plain `pending_change_kind IS NULL` row would otherwise
  -- compare NULL against false and fail its own CHECK.
  CONSTRAINT subscription_modules_removal_status CHECK (
    (pending_change_kind IS NOT DISTINCT FROM 'remove') = (status = 'pending_removal')
  )
);

-- One module per ladder per subscription, whatever its status: a pending add
-- occupies the slot so a second one cannot be started alongside it.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_modules_one_per_audience_idx
  ON subscription_modules (subscription_id, audience);
CREATE INDEX IF NOT EXISTS subscription_modules_plan_id_idx ON subscription_modules (plan_id);
CREATE INDEX IF NOT EXISTS subscription_modules_pending_plan_id_idx
  ON subscription_modules (pending_plan_id) WHERE pending_plan_id IS NOT NULL;

-- Audience is derived on INSERT and PROTECTED thereafter — the same three jobs
-- migration 166 gave the subscriptions table, retargeted at the module.
-- Deliberately not a "re-derive on every write" rule: re-deriving would happily
-- convert a band module to artist on a raw plan_id UPDATE, and would never fire
-- at all on a direct `SET audience = ...`.
CREATE OR REPLACE FUNCTION subscription_modules_set_audience()
RETURNS TRIGGER AS $$
DECLARE plan_audience TEXT; plan_is_fallback BOOLEAN;
BEGIN
  SELECT p.audience, p.is_fallback INTO plan_audience, plan_is_fallback
    FROM subscription_plans p WHERE p.id = NEW.plan_id;
  IF plan_audience IS NULL THEN
    RAISE EXCEPTION 'subscription plan % not found', NEW.plan_id USING ERRCODE = '23503';
  END IF;
  -- A module IS the purchase. The free floor is what a MISSING module resolves
  -- to, so a fallback plan can never be one.
  IF plan_is_fallback THEN
    RAISE EXCEPTION 'plan % is a free fallback and cannot be a subscription module', NEW.plan_id
      USING ERRCODE = '23514';
  END IF;
  -- Derived, never supplied: any caller-provided value is discarded.
  NEW.audience := plan_audience;

  IF NEW.pending_plan_id IS NOT NULL
     AND (SELECT p.audience FROM subscription_plans p WHERE p.id = NEW.pending_plan_id)
         IS DISTINCT FROM plan_audience THEN
    RAISE EXCEPTION 'pending plan % does not match module audience %', NEW.pending_plan_id, plan_audience
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER subscription_modules_set_audience_trg
  BEFORE INSERT ON subscription_modules
  FOR EACH ROW EXECUTE FUNCTION subscription_modules_set_audience();

CREATE OR REPLACE FUNCTION subscription_modules_audience_immutable()
RETURNS TRIGGER AS $$
DECLARE plan_audience TEXT; plan_is_fallback BOOLEAN;
BEGIN
  IF NEW.audience IS DISTINCT FROM OLD.audience THEN
    RAISE EXCEPTION 'subscription_modules.audience is immutable (module %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    SELECT p.audience, p.is_fallback INTO plan_audience, plan_is_fallback
      FROM subscription_plans p WHERE p.id = NEW.plan_id;
    IF plan_audience IS DISTINCT FROM OLD.audience THEN
      RAISE EXCEPTION
        'module % is audience %, plan % is audience % — modules cannot change ladder',
        OLD.id, OLD.audience, NEW.plan_id, plan_audience
        USING ERRCODE = '23514';
    END IF;
    IF plan_is_fallback THEN
      RAISE EXCEPTION 'plan % is a free fallback and cannot be a subscription module', NEW.plan_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- A scheduled change always lands on the ladder it started from.
  IF NEW.pending_plan_id IS NOT NULL
     AND (SELECT p.audience FROM subscription_plans p WHERE p.id = NEW.pending_plan_id)
         IS DISTINCT FROM NEW.audience THEN
    RAISE EXCEPTION 'module % is audience %, pending plan % is not',
      OLD.id, NEW.audience, NEW.pending_plan_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER subscription_modules_audience_immutable_trg
  BEFORE UPDATE ON subscription_modules
  FOR EACH ROW EXECUTE FUNCTION subscription_modules_audience_immutable();

-- ---------------------------------------------------- legacy subscriptions ----
--
-- Everything in this section runs BEFORE the legacy columns are dropped, and
-- the whole file is one implicit transaction, so a RAISE below rolls back the
-- entire migration and leaves the old container serving an untouched schema.

-- Normalization first, refusals second: a row whose new-model equivalent is
-- exact is simply converted, and only what is left over has to stop the deploy.

-- A live subscription pinned to a FREE FLOOR plan has no module — absence of a
-- module IS that ladder's free plan. Keeping the row would leave a subscription
-- that grants exactly the fallback while occupying the user's one live slot and
-- reporting `already_subscribed` to anyone trying to start a trial. Cancelling
-- it grants precisely the same entitlements and frees the slot. These carry no
-- provider schedule: a fallback plan is priced at zero.
UPDATE subscriptions s
   SET status = 'canceled',
       cancel_reason = COALESCE(s.cancel_reason, 'superseded'),
       canceled_at = COALESCE(s.canceled_at, NOW()),
       updated_at = NOW()
  FROM subscription_plans p
 WHERE p.id = s.plan_id
   AND p.is_fallback
   AND s.status <> 'canceled';

-- 'pending_mandate' is dropped from the status CHECK further down. It meant
-- "awaiting the €0.01 mandate-verification payment", which grants nothing —
-- exactly what 'pending_activation' means in the new model, where conversion's
-- first full charge establishes the mandate instead. The in-flight verification
-- payment keeps its row: 'mandate_verification' stays a legal payment kind.
UPDATE subscriptions
   SET status = 'pending_activation', updated_at = NOW()
 WHERE status = 'pending_mandate';

-- Preflight. These shapes cannot be represented on the far side, and every one
-- of them may own a live Mollie object, so a blind conversion here would orphan
-- money at the provider. Resolve them through the app and redeploy.
DO $$
DECLARE offenders INTEGER;
BEGIN
  -- Two live subscriptions for one user is precisely what the OLD model sold
  -- (migration 166 replaced the per-user index with a per-user-per-audience
  -- one so a musician could hold band and artist at the same time). Merging
  -- them is not a SQL operation: each side has its own mandate, provider
  -- schedule, billing interval and period end, and the new model bills one
  -- combined amount on ONE cycle. Left alone, this surfaces as a bare unique
  -- violation when subscriptions_one_live_per_user_idx is created below.
  SELECT COUNT(*) INTO offenders
    FROM (SELECT user_id FROM subscriptions WHERE status <> 'canceled'
           GROUP BY user_id HAVING COUNT(*) > 1) dupes;
  IF offenders > 0 THEN
    RAISE EXCEPTION
      '% user(s) hold more than one live subscription. The module model bills one '
      'combined amount on one cycle, so these must be consolidated through the app '
      '(cancel the second product, then re-add it as a module after the deploy) — '
      'merging two provider schedules in SQL would orphan a Mollie subscription.',
      offenders;
  END IF;

  -- A pending INTERVAL switch has nowhere to land: pending_billing_interval is
  -- dropped below and the module's pending change carries a plan, not a cycle.
  SELECT COUNT(*) INTO offenders
    FROM subscriptions
   WHERE status <> 'canceled'
     AND (pending_change_kind = 'interval'
          OR (pending_billing_interval IS NOT NULL
              AND pending_billing_interval IS DISTINCT FROM billing_interval));
  IF offenders > 0 THEN
    RAISE EXCEPTION
      '% subscription(s) have a billing-interval change in flight. Let it settle or '
      'cancel it through the app before migrating.', offenders;
  END IF;

  -- Downgrade-to-fallback rode the CANCEL path in the old model: cancel at
  -- period end, with the purge manifest frozen on the subscription. The new
  -- model expresses that as a module removal (pending_change_kind = 'remove'),
  -- which is a different provider outcome — the cycle survives if another
  -- module remains. Converting it blind could either purge on a subscription
  -- that should have ended or bill one that should not.
  SELECT COUNT(*) INTO offenders
    FROM subscriptions
   WHERE status <> 'canceled'
     AND cancel_at_period_end
     AND pending_purge_manifest IS NOT NULL;
  IF offenders > 0 THEN
    RAISE EXCEPTION
      '% subscription(s) have a pending downgrade-to-free riding the cancel path. '
      'Let the period boundary settle it, or cancel the scheduled downgrade through '
      'the app, before migrating.', offenders;
  END IF;
END $$;

-- Back-fill: every surviving live subscription becomes a one-module
-- subscription on the ladder it already belonged to. This is what keeps the
-- DROP COLUMNs below non-destructive.
--
-- audience is supplied but not trusted — subscription_modules_set_audience
-- re-derives it from the plan and rejects a fallback, which is why the free
-- floor was cancelled above rather than left for the trigger to refuse.
-- Canceled subscriptions get no module: nothing reads a canceled row's plan,
-- and a module has no state that means "ended".
INSERT INTO subscription_modules (
  subscription_id, audience, plan_id, status, price_cents, is_starter,
  entitlement_overrides, pending_plan_id, pending_change_kind, pending_price_cents,
  pending_purge_manifest, pending_limits_snapshot, downgrade_confirmed_at,
  added_at, created_at, updated_at)
SELECT s.id,
       s.audience,
       s.plan_id,
       -- A subscription that never activated grants nothing, and neither does a
       -- 'pending' module; the two agree rather than the module claiming to
       -- grant a plan the subscription is still withholding.
       CASE WHEN s.status = 'pending_activation' THEN 'pending' ELSE 'active' END,
       s.price_cents,
       -- It is the module the subscription started with, by definition: it is
       -- the only one it has ever had.
       TRUE,
       s.entitlement_overrides,
       s.pending_plan_id,
       s.pending_change_kind,
       s.pending_price_cents,
       s.pending_purge_manifest,
       s.pending_limits_snapshot,
       s.downgrade_confirmed_at,
       s.created_at,
       s.created_at,
       NOW()
  FROM subscriptions s
 WHERE s.status <> 'canceled'
ON CONFLICT (subscription_id, audience) DO NOTHING;

-- price_snapshot and total_cents are deliberately left NULL on a back-filled
-- row: no one was ever charged a combined amount for a configuration that did
-- not exist, and synthesizing one would be inventing a price agreement. The
-- scheduler's reconcileNextPeriodPricing recomputes next_price_snapshot /
-- next_total_cents from the module set on its first tick, and the renewal that
-- follows installs a real price_snapshot for the period it charges.

-- ----------------------------------------------------------- subscriptions ----

ALTER TABLE subscriptions
  -- The current period's configuration and what it was charged. Complete and
  -- self-contained (shared/pricing.js validatePriceSnapshot) so an existing
  -- price agreement stays reproducible after the catalog moves on.
  ADD COLUMN IF NOT EXISTS price_snapshot         JSONB,
  ADD COLUMN IF NOT EXISTS total_cents            INTEGER CHECK (total_cents >= 0),
  -- What the NEXT renewal will charge, and the durable mirror of the provider
  -- schedule's amount. Recomputed when the configuration changes and when a
  -- time-limited discount lapses — that is what makes a temporary promo
  -- actually temporary instead of granting one customer the promo forever.
  ADD COLUMN IF NOT EXISTS next_price_snapshot    JSONB,
  ADD COLUMN IF NOT EXISTS next_total_cents       INTEGER CHECK (next_total_cents >= 0),
  -- A mid-cycle module change awaiting its prorated charge.
  ADD COLUMN IF NOT EXISTS pending_price_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS pending_total_cents    INTEGER CHECK (pending_total_cents >= 0),
  ADD COLUMN IF NOT EXISTS converted_at           TIMESTAMPTZ,
  -- The charge that OPENED the current period (conversion or renewal). Anchors
  -- the withdrawal window inside which cancelling refunds that charge in full.
  ADD COLUMN IF NOT EXISTS last_charge_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_charge_payment_id TEXT;

-- The audience triggers would refuse every state the module model needs: a
-- subscription that starts as a band trial and later adds an artist module has
-- no single audience at all.
DROP TRIGGER IF EXISTS subscriptions_set_audience_trg ON subscriptions;
DROP TRIGGER IF EXISTS subscriptions_audience_immutable_trg ON subscriptions;
DROP FUNCTION IF EXISTS subscriptions_set_audience();
DROP FUNCTION IF EXISTS subscriptions_audience_immutable();

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_pending_all_or_none,
  DROP CONSTRAINT IF EXISTS subscriptions_cancel_xor_pending,
  DROP CONSTRAINT IF EXISTS subscriptions_audience_check;

-- Plan, price, overrides and every pending-change / downgrade column are module
-- state now.
ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS plan_id,
  DROP COLUMN IF EXISTS price_cents,
  DROP COLUMN IF EXISTS audience,
  DROP COLUMN IF EXISTS entitlement_overrides,
  DROP COLUMN IF EXISTS pending_plan_id,
  DROP COLUMN IF EXISTS pending_change_kind,
  DROP COLUMN IF EXISTS pending_billing_interval,
  DROP COLUMN IF EXISTS pending_price_cents,
  DROP COLUMN IF EXISTS pending_purge_manifest,
  DROP COLUMN IF EXISTS pending_limits_snapshot,
  DROP COLUMN IF EXISTS downgrade_confirmed_at,
  -- The downgrade REPLACEMENT saga is gone with the model that needed it: a
  -- downgrade no longer means a different provider subscription, just a
  -- scheduled change to the same cycle's amount.
  DROP COLUMN IF EXISTS downgrade_schedule_pending,
  DROP COLUMN IF EXISTS superseded_mollie_subscription_id;

-- 'pending_mandate' existed only for the €0.01 mandate-verification payment.
-- Conversion's first charge is the full combined amount AND establishes the
-- mandate, so a subscription awaiting its first settled charge is simply
-- 'pending_activation'. Removing the value keeps the state machine honest —
-- there are no rows to migrate.
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN
  ('pending_activation','trialing','active','past_due','canceled'));

-- One live subscription per user again — the modules carry the ladders now.
DROP INDEX IF EXISTS subscriptions_one_live_per_user_audience_idx;
DROP INDEX IF EXISTS subscriptions_audience_idx;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live_per_user_idx
  ON subscriptions (user_id) WHERE status <> 'canceled';

-- Renewal notices sweep on the period boundary every tick.
CREATE INDEX IF NOT EXISTS subscriptions_current_period_end_idx
  ON subscriptions (current_period_end) WHERE status = 'active';

-- -------------------------------------------------------------- payments ----

-- 'conversion' is the trial's first full combined charge, which also
-- establishes the mandate (there is no €0.01 verification payment any more).
-- 'proration' is the positive difference owed for a mid-cycle module change.
ALTER TABLE subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_kind_check;
ALTER TABLE subscription_payments
  ADD CONSTRAINT subscription_payments_kind_check CHECK (kind IN
    ('mandate_verification','conversion','recurring','plan_change','proration'));

-- What this specific charge billed — the audit trail and the basis for a refund.
ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS price_snapshot JSONB;
