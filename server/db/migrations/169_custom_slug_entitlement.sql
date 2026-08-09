-- Changing a band's public slug is a Gold feature. Every stored plan must
-- carry every entitlement key, so custom/admin-created plans default to off.
UPDATE subscription_plans
   SET entitlements = jsonb_set(
         entitlements,
         '{features,custom_slug}',
         'false'::jsonb,
         true
       ),
       updated_at = NOW()
 WHERE NOT (entitlements #> '{features}' ? 'custom_slug');

UPDATE subscription_plans
   SET entitlements = jsonb_set(
         entitlements,
         '{features,custom_slug}',
         'true'::jsonb,
         true
       ),
       updated_at = NOW()
 WHERE slug = 'gold'
   AND audience = 'band';
