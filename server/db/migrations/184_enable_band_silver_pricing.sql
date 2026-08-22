-- Band Silver is a customer-selectable paid module. Existing installations
-- created it without prices, which makes the catalog deliberately hide it.
-- Supply the canonical defaults while preserving any admin-configured price.

UPDATE subscription_plans
SET monthly_price_cents = COALESCE(monthly_price_cents, 999),
    yearly_price_cents = COALESCE(yearly_price_cents, 9999),
    updated_at = NOW()
WHERE slug = 'silver'
  AND audience = 'band';
