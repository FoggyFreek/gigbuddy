-- Link-page entitlements: the decoupled linkpage app becomes a paid feature.
-- New keys on every stored plan (complete-entitlements validation requires
-- every key present):
--   features.linkpage           — silver/gold
--   limits.linkpage_pages       — max smart (release) link pages per band
--   limits.linkpage_stats_days  — rolling statistics window (30 or 90 days)
-- Keep in sync with server/db/defaultPlans.js.

-- Default the new keys on every plan that doesn't have them yet (custom
-- plans included): feature off, no release pages, 30-day window.
UPDATE subscription_plans
   SET entitlements =
     jsonb_set(
       jsonb_set(
         jsonb_set(entitlements, '{features,linkpage}', 'false', true),
         '{limits,linkpage_pages}', '0', true),
       '{limits,linkpage_stats_days}', '30', true)
 WHERE NOT (entitlements->'features' ? 'linkpage');

-- Default tier values (rows freshly defaulted above get their real caps).
UPDATE subscription_plans
   SET entitlements =
     jsonb_set(
       jsonb_set(
         jsonb_set(entitlements, '{features,linkpage}', 'true', true),
         '{limits,linkpage_pages}', '3', true),
       '{limits,linkpage_stats_days}', '30', true)
 WHERE slug = 'silver';

UPDATE subscription_plans
   SET entitlements =
     jsonb_set(
       jsonb_set(
         jsonb_set(entitlements, '{features,linkpage}', 'true', true),
         '{limits,linkpage_pages}', '30', true),
       '{limits,linkpage_stats_days}', '90', true)
 WHERE slug = 'gold';
