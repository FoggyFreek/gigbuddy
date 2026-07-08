-- Subscription plan catalog — the platform-level source of truth for tiers,
-- pricing, and entitlements. NOT tenant-scoped: plans are global and managed
-- by super admins only.
--
-- Pricing semantics (per interval):
--   NULL = interval unavailable (cannot be subscribed to yet)
--   0    = free — allowed on the fallback plan only (service rule + the
--          fallback CHECK below; the service rejects 0 on any other plan)
--   > 0  = paid, in euro cents
--
-- Entitlements are a complete JSONB object (see shared/entitlements.js):
--   { "features": { <flag>: bool, ... }, "limits": { <cap>: int|null, ... } }
-- with null meaning unlimited.

CREATE TABLE subscription_plans (
  id                  SERIAL PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  monthly_price_cents INTEGER CHECK (monthly_price_cents >= 0),
  yearly_price_cents  INTEGER CHECK (yearly_price_cents >= 0),
  entitlements        JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  is_fallback         BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- DB backstop for fallback integrity: the fallback plan is always active
  -- and always free. (Undeletable/unrenamable is enforced in the service.)
  CONSTRAINT subscription_plans_fallback_integrity CHECK (
    NOT is_fallback
    OR (is_active AND monthly_price_cents = 0 AND yearly_price_cents = 0)
  )
);

-- Exactly one fallback plan can exist.
CREATE UNIQUE INDEX subscription_plans_single_fallback_idx
  ON subscription_plans ((TRUE))
  WHERE is_fallback;

-- Default tiers — keep in sync with server/db/defaultPlans.js (the JS source
-- of truth). Bronze is the free fallback; silver/gold stay unavailable
-- (NULL prices) until an admin sets prices.
INSERT INTO subscription_plans
  (slug, name, monthly_price_cents, yearly_price_cents, entitlements, is_active, is_fallback, sort_order)
VALUES
  (
    'bronze', 'Bronze', 0, 0,
    '{
      "features": {"finance": false, "integrations": false, "customization": false, "song_files": false, "chordpro": false, "public_promotion": false},
      "limits": {"storage_mb": 50, "members": 5, "bands": 1}
    }'::jsonb,
    TRUE, TRUE, 1
  ),
  (
    'silver', 'Silver', NULL, NULL,
    '{
      "features": {"finance": false, "integrations": true, "customization": true, "song_files": true, "chordpro": true, "public_promotion": true},
      "limits": {"storage_mb": 150, "members": null, "bands": 3}
    }'::jsonb,
    TRUE, FALSE, 2
  ),
  (
    'gold', 'Gold', NULL, NULL,
    '{
      "features": {"finance": true, "integrations": true, "customization": true, "song_files": true, "chordpro": true, "public_promotion": true},
      "limits": {"storage_mb": 500, "members": null, "bands": null}
    }'::jsonb,
    TRUE, FALSE, 3
  );
