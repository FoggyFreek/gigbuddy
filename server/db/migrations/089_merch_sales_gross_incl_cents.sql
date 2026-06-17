-- Exact inclusive line total for imported sales. A discounted multi-quantity
-- Shopify line gross often isn't divisible by the quantity, so the per-unit
-- unit_price_incl_cents can't represent it exactly. Imports store the precise
-- gross here; manual sales leave it NULL and keep using
-- quantity * unit_price_incl_cents. Guarded like the other money columns.
ALTER TABLE merch_sales
  ADD COLUMN gross_incl_cents INTEGER
  CHECK (gross_incl_cents IS NULL OR gross_incl_cents >= 0);
