-- Subscription plans split into two independent PRODUCTS: the band ladder and
-- the artist ladder (shared/planAudiences.js). A subscription is bound to its
-- audience for life — there is no upgrade or downgrade across the boundary —
-- and a user may hold one live subscription per audience at the same time.
-- Tenant kind selects which audience governs a tenant: band → band subscription,
-- personal → artist subscription.
--
-- Applied as a single migration because no user holds a live paid subscription:
-- there is nothing to grandfather and no revenue to protect through a staged
-- rollout. The one residual overlap risk is that the old container's audience-
-- blind fallback lookup (WHERE is_fallback LIMIT 1) may pick the artist floor
-- for a band tenant during the deploy window. That is read-time only — no data
-- is purged and nothing is written — and it resolves as soon as the new
-- container serves. With paying customers this would need two deploys.

-- ---------------------------------------------------------------- plans ----

ALTER TABLE subscription_plans
  ADD COLUMN audience TEXT NOT NULL DEFAULT 'band'
    CHECK (audience IN ('band','artist'));

-- Classify existing plans onto the two ladders.
--
-- Deliberately NOT keyed on the slug: slugs in this catalog are admin-editable
-- and have already drifted from what migration 160 seeded (the artist tier is
-- 'artistgold' in some databases, since isValidSlug rejects the underscore in
-- 'artist_gold'). The semantic property is stable — before the split, "artist
-- plan" meant exactly `limits.bands = 0`, because a plan granting no bands of
-- your own is only usable from a personal workspace.
--
-- The fallback is excluded: the band ladder's free floor stays where it is, and
-- the artist floor is inserted fresh below.
--
-- sort_order now ranks WITHIN an audience, so the artist ladder re-bases from 1
-- in the existing relative order (artist_bronze takes 1; these follow).
WITH artist_plans AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, id) AS rank
    FROM subscription_plans
   WHERE NOT is_fallback
     AND (entitlements #> '{limits,bands}') = '0'::jsonb
)
UPDATE subscription_plans p
   SET audience = 'artist', sort_order = a.rank + 1, updated_at = NOW()
  FROM artist_plans a
 WHERE p.id = a.id;

-- Preflight. Before the split nothing stopped scheduling a cross-product change
-- (gold → artist_gold classified as an ordinary downgrade). Such a row would be
-- stranded: the backfill below derives audience from the CURRENT plan, leaving a
-- pending target the new model cannot represent. These cannot be cleared here —
-- a pending downgrade may already own a remote Mollie replacement schedule, and
-- a blind wipe orphans it at the provider. Resolve them through the app first:
--   node server/scripts/checkCrossAudiencePending.js --check
DO $$
DECLARE offenders INTEGER;
BEGIN
  SELECT COUNT(*) INTO offenders
    FROM subscriptions s
    JOIN subscription_plans p  ON p.id  = s.plan_id
    JOIN subscription_plans pp ON pp.id = s.pending_plan_id
   WHERE s.status <> 'canceled'
     AND s.pending_plan_id IS NOT NULL
     AND pp.audience IS DISTINCT FROM p.audience;

  IF offenders > 0 THEN
    RAISE EXCEPTION
      '% subscription(s) have a cross-audience pending plan change. Resolve them through the app '
      '(cancel the pending change) before migrating; see '
      'server/scripts/checkCrossAudiencePending.js --check', offenders;
  END IF;
END $$;

-- A plan's audience is immutable: subscriptions.audience is derived from it, so
-- a catalog edit would silently desync every live row bound to that plan.
CREATE OR REPLACE FUNCTION subscription_plans_audience_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.audience IS DISTINCT FROM OLD.audience THEN
    RAISE EXCEPTION 'subscription_plans.audience is immutable (plan %)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_plans_audience_immutable_trg
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION subscription_plans_audience_immutable();

-- One free floor per ladder, instead of one globally.
DROP INDEX subscription_plans_single_fallback_idx;
CREATE UNIQUE INDEX subscription_plans_single_fallback_per_audience_idx
  ON subscription_plans (audience)
  WHERE is_fallback;

-- The artist ladder's free floor. Storage mirrors bronze's seeded default
-- deliberately: a fallback plan has no downgrade, blocker, consent or purge
-- path, so a smaller one would simply start rejecting uploads from personal
-- workspaces already above it. Keep in sync with server/db/defaultPlans.js.
INSERT INTO subscription_plans
  (slug, name, audience, monthly_price_cents, yearly_price_cents, entitlements,
   is_active, is_fallback, sort_order)
VALUES
  (
    'artist_bronze', 'Artist Bronze', 'artist', 0, 0,
    '{
      "features": {"finance": false, "integrations": false, "customization": false, "song_files": false, "chordpro": false, "public_promotion": false, "linkpage": false, "calendar_sync": false},
      "limits": {"storage_mb": 50, "members": 1, "bands": 0, "linkpage_pages": 0, "linkpage_stats_days": 30}
    }'::jsonb,
    TRUE, TRUE, 1
  )
ON CONFLICT (slug) DO NOTHING;

-- -------------------------------------------------------- subscriptions ----

ALTER TABLE subscriptions ADD COLUMN audience TEXT;

UPDATE subscriptions s
   SET audience = p.audience
  FROM subscription_plans p
 WHERE p.id = s.plan_id;

ALTER TABLE subscriptions
  ALTER COLUMN audience SET NOT NULL,
  ADD CONSTRAINT subscriptions_audience_check CHECK (audience IN ('band','artist'));

-- Audience is derived on INSERT and PROTECTED thereafter. Three distinct jobs,
-- deliberately not one "re-derive on every write" rule: re-deriving would
-- happily convert a band subscription to artist on a raw plan_id UPDATE, and it
-- would never fire at all on a direct `SET audience = ...`.
CREATE OR REPLACE FUNCTION subscriptions_set_audience()
RETURNS TRIGGER AS $$
DECLARE plan_audience TEXT;
BEGIN
  -- Derived, never supplied: any caller-provided value is discarded. This also
  -- keeps the old container's audience-unaware INSERTs working during deploy A.
  SELECT p.audience INTO plan_audience
    FROM subscription_plans p WHERE p.id = NEW.plan_id;
  IF plan_audience IS NULL THEN
    RAISE EXCEPTION 'subscription plan % not found', NEW.plan_id USING ERRCODE = '23503';
  END IF;
  NEW.audience := plan_audience;

  -- The app cannot set pending_* at insert time (insertSubscription's column
  -- allowlist excludes them), but a raw INSERT can, and the row would be born
  -- straddling both ladders.
  IF NEW.pending_plan_id IS NOT NULL
     AND (SELECT p.audience FROM subscription_plans p WHERE p.id = NEW.pending_plan_id)
         IS DISTINCT FROM plan_audience THEN
    RAISE EXCEPTION 'pending plan % does not match audience %', NEW.pending_plan_id, plan_audience
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscriptions_set_audience_trg
  BEFORE INSERT ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_set_audience();

CREATE OR REPLACE FUNCTION subscriptions_audience_immutable()
RETURNS TRIGGER AS $$
DECLARE plan_audience TEXT;
BEGIN
  IF NEW.audience IS DISTINCT FROM OLD.audience THEN
    RAISE EXCEPTION 'subscriptions.audience is immutable (subscription %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  -- Moving to a plan on the other ladder would change the product the row
  -- represents. Upgrades and downgrades stay inside one audience.
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    SELECT p.audience INTO plan_audience
      FROM subscription_plans p WHERE p.id = NEW.plan_id;
    IF plan_audience IS DISTINCT FROM OLD.audience THEN
      RAISE EXCEPTION
        'subscription % is audience %, plan % is audience % — plans cannot change audience',
        OLD.id, OLD.audience, NEW.plan_id, plan_audience
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Same rule for a SCHEDULED change: a pending upgrade or downgrade always
  -- lands on the same ladder it started from.
  IF NEW.pending_plan_id IS NOT NULL THEN
    SELECT p.audience INTO plan_audience
      FROM subscription_plans p WHERE p.id = NEW.pending_plan_id;
    IF plan_audience IS DISTINCT FROM NEW.audience THEN
      RAISE EXCEPTION
        'subscription % is audience %, pending plan % is audience %',
        OLD.id, NEW.audience, NEW.pending_plan_id, plan_audience
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscriptions_audience_immutable_trg
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_audience_immutable();

-- Two live subscriptions per user are now legal — one per audience. This only
-- relaxes the old rule; the old container still refuses a second row via its own
-- audience-blind check, so deploy A stays safe while both versions serve.
DROP INDEX subscriptions_one_live_per_user_idx;
CREATE UNIQUE INDEX subscriptions_one_live_per_user_audience_idx
  ON subscriptions (user_id, audience) WHERE status <> 'canceled';
CREATE INDEX subscriptions_audience_idx ON subscriptions (audience);
