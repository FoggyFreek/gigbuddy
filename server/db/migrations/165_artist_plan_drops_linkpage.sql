-- Link pages are a band capability (`band_linkpage`), and an artist plan owns
-- no band — its subscriber only ever has a personal workspace, where the
-- backend now refuses `/linkpage/*` and the public export. Migration 160
-- shipped the tier with `linkpage: true`, which advertises a feature the plan
-- can never reach. Correct the seeded row; keep in sync with
-- server/db/defaultPlans.js.
UPDATE subscription_plans
   SET entitlements = jsonb_set(
         jsonb_set(
           jsonb_set(entitlements, '{features,linkpage}', 'false'::jsonb),
           '{limits,linkpage_pages}', '0'::jsonb
         ),
         '{limits,linkpage_stats_days}', '30'::jsonb
       ),
       updated_at = NOW()
 WHERE slug = 'artist_gold';
