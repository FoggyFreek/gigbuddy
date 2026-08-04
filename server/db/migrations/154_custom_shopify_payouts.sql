-- Locally reconstructed payouts cover imported Shopify Payments orders whose
-- payout objects have aged out of Shopify's payout API retention window.

ALTER TABLE shopify_payments_payouts
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'shopify_api'
    CHECK (origin IN ('shopify_api', 'custom'));
