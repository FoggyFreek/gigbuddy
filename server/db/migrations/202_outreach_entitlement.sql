UPDATE subscription_plans
SET entitlements = jsonb_set(entitlements, '{features,outreach}', 'false'::jsonb, true), updated_at = NOW()
WHERE NOT (entitlements #> '{features}' ? 'outreach');
UPDATE subscription_plans
SET entitlements = jsonb_set(entitlements, '{features,outreach}', 'true'::jsonb, true), updated_at = NOW()
WHERE (audience = 'band' AND slug IN ('silver', 'gold'))
   OR (audience = 'artist' AND slug = 'artist_gold');
