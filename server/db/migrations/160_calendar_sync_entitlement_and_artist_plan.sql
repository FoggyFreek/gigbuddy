-- `calendar_sync` splits the ICS feed out of the `integrations` feature so
-- "planning, but no calendar sync" becomes expressible — the shape a free
-- artist workspace takes.
--
-- Every stored entitlements object must carry every key (validateEntitlements
-- requires it), so existing rows are backfilled here. The value inherits the
-- row's own `integrations` flag: the feed is gated on integrations today, so
-- every plan — including any an admin created — keeps exactly the access it
-- has right now. For the default tiers that resolves to false/true/true.
UPDATE subscription_plans
   SET entitlements = jsonb_set(
         entitlements,
         '{features,calendar_sync}',
         COALESCE(entitlements #> '{features,integrations}', 'false'::jsonb)
       ),
       updated_at = NOW()
 WHERE NOT (entitlements #> '{features}' ? 'calendar_sync');

-- The artist tier: all features, `bands: 0`. The subscriber's personal
-- workspace is outside the band cap, so 0 means "no bands of your own" while
-- the workspace keeps working. Keep in sync with server/db/defaultPlans.js.
INSERT INTO subscription_plans
  (slug, name, monthly_price_cents, yearly_price_cents, entitlements, is_active, is_fallback, sort_order)
VALUES
  (
    'artist_gold', 'Artist Gold', NULL, NULL,
    '{
      "features": {"finance": true, "integrations": true, "customization": true, "song_files": true, "chordpro": true, "public_promotion": true, "linkpage": true, "calendar_sync": true},
      "limits": {"storage_mb": 250, "members": 1, "bands": 0, "linkpage_pages": 5, "linkpage_stats_days": 90}
    }'::jsonb,
    TRUE, FALSE, 4
  )
ON CONFLICT (slug) DO NOTHING;
