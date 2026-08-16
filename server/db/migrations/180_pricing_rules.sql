-- Configurable discounts for platform subscriptions: percentage or fixed
-- amount, active/inactive, an effective window, a combinable flag, a stable
-- code, and a version.
--
-- The version is what keeps an existing price agreement reproducible. A
-- subscription's price snapshot records { code, version } for every discount it
-- was priced with, so the admin service never edits pricing semantics in place:
-- changing the type, the value or the conditions deactivates the current row
-- and inserts version + 1, leaving the row that priced the agreement on disk.
-- Only cosmetic fields (name) are editable in place.
--
-- Additive and unreferenced: nothing reads this table until the subscription
-- module model lands, so it is safe on its own in any deploy order.

CREATE TABLE pricing_rules (
  id                 SERIAL PRIMARY KEY,
  -- Stable across versions: 'dual_module_bundle', 'apr_2027_marketing'.
  code               TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  name               TEXT NOT NULL,
  discount_type      TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed')),
  -- Exactly one of these carries the value, chosen by discount_type. Two
  -- columns rather than one polymorphic value so each keeps a real CHECK and
  -- the type stays the discriminator.
  percent            NUMERIC(5,2) CHECK (percent > 0 AND percent <= 100),
  amount_cents       INTEGER CHECK (amount_cents > 0),
  -- FALSE means "applies alone": once this rule is chosen no other discount
  -- stacks on top of it, and it is skipped if another already applied.
  combinable         BOOLEAN NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  -- Half-open window [from, to). NULL on either side means unbounded.
  effective_from     TIMESTAMPTZ,
  effective_to       TIMESTAMPTZ,
  -- Applicability, evaluated against the subscription's module set in
  -- shared/pricing.js. Empty required_audiences = any.
  required_audiences TEXT[] NOT NULL DEFAULT '{}',
  min_module_count   INTEGER NOT NULL DEFAULT 1 CHECK (min_module_count >= 1),
  billing_intervals  TEXT[] NOT NULL DEFAULT '{month,year}',
  -- Application order; ties broken by code so selection is deterministic.
  priority           INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pricing_rules_code_version_key UNIQUE (code, version),
  CONSTRAINT pricing_rules_value_matches_type CHECK (
    (discount_type = 'percentage' AND percent IS NOT NULL AND amount_cents IS NULL)
    OR
    (discount_type = 'fixed' AND amount_cents IS NOT NULL AND percent IS NULL)
  ),
  CONSTRAINT pricing_rules_window CHECK (
    effective_from IS NULL OR effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT pricing_rules_required_audiences_valid CHECK (
    required_audiences <@ ARRAY['band','artist']::TEXT[]
  ),
  CONSTRAINT pricing_rules_billing_intervals_valid CHECK (
    billing_intervals <@ ARRAY['month','year']::TEXT[]
    AND array_length(billing_intervals, 1) >= 1
  )
);

-- At most one live version of a code. Superseded versions stay, inactive, so
-- the snapshots that reference them remain resolvable.
CREATE UNIQUE INDEX pricing_rules_one_active_per_code_idx
  ON pricing_rules (code) WHERE is_active;

-- The pricing engine loads the live catalog on every quote.
CREATE INDEX pricing_rules_active_idx ON pricing_rules (priority, code) WHERE is_active;
