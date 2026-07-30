-- Extracts the tenant's accounting REGIME into its own record.
--
-- Until now the regime was scattered: `tenants.vat_country` (silently defaulting
-- to 'nl'), `tenants.legal_form`, `tenants.tax_percentage`, `tenants.applies_kor`,
-- and `tenant_accounting_settings.currency` — while micro/small entity size, VAT
-- filing frequency, the fiscal-year start, the cash-vs-accrual bases and the
-- applicable reporting framework had nowhere to live at all. Every later
-- compliance capability (retention periods, VAT-by-category, country chart packs,
-- fiscal-year close, micro-company reports) needs one authoritative record to
-- read those facts from, so it gets one here.
--
-- This migration is deliberately ADDITIVE ONLY. Deployment runs migrations while
-- the previous app container is still serving (`docker compose run --rm migrate`
-- before `docker compose up -d app`), so the legacy columns must keep working
-- until a later deployment drops them. Nothing in this migration changes how any
-- document renders or how any period resolves.
--
-- Scope notes:
--   * `books_closed_through` stays on tenant_accounting_settings — it is ledger
--     wiring read on every posting path, not regime.
--   * There is no vat_scheme column: scheme identity needs effective-dated
--     enrolments plus issued-document snapshots to be correct, which is its own
--     migration. `tenants.applies_kor` is untouched here.
--   * `base_currency` records the FACTUAL currency (GBP for gb) but is
--     behaviorally inert: the PDF/UBL renderers and the money formatter are still
--     EUR-only, so existing behavior keeps reading
--     tenant_accounting_settings.currency until that is made currency-aware.

CREATE TABLE IF NOT EXISTS tenant_accounting_profiles (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- The accounting country: the jurisdiction whose bookkeeping rules apply.
  -- Distinct from the postal address country (an address attribute) and, later,
  -- from any foreign VAT registrations.
  country_code TEXT NOT NULL
    CONSTRAINT tap_country_code_supported
    CHECK (country_code IN ('nl', 'be', 'de', 'fr', 'lu', 'at', 'es', 'it', 'ie', 'gb')),

  -- Field completeness only. Regulatory readiness is a separate, later concept
  -- that also needs country packs, tax categories and reconciliation — never
  -- conflate the two in UI copy.
  profile_status TEXT NOT NULL DEFAULT 'incomplete'
    CONSTRAINT tap_profile_status_known
    CHECK (profile_status IN ('incomplete', 'complete')),

  -- Provenance is orthogonal to completeness: a backfilled row and a
  -- user-created row can both be incomplete, but only one of them was ever
  -- chosen by a human.
  profile_source TEXT NOT NULL
    CONSTRAINT tap_profile_source_known
    CHECK (profile_source IN ('tenant_creation', 'legacy_backfill', 'repair')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Cross-country abstraction (mirrors 128_tenant_legal_form.sql) plus the exact
  -- local form as a stable code (nl_vof, de_gmbh, …) with an optional free-text
  -- note. The code drives future pack behavior; the label is display only.
  legal_form TEXT
    CONSTRAINT tap_legal_form_known
    CHECK (legal_form IN ('sole_trader', 'partnership', 'company', 'association', 'other')),
  local_legal_form_code TEXT,
  local_legal_form_label TEXT,

  -- Recorded, not asked. The product targets micro entities — a band, ensemble or
  -- one-person artist business — and the reporting it produces is scoped to that.
  -- A band that genuinely reports as a small or larger entity needs report
  -- templates and disclosures this application does not have, so offering the
  -- choice as a dropdown would promise coverage that is absent. Widening the scope
  -- is what would set this column (and would also need effective dating, since an
  -- entity can cross the micro threshold between reporting years).
  entity_size TEXT NOT NULL DEFAULT 'micro'
    CONSTRAINT tap_entity_size_known
    CHECK (entity_size IN ('micro', 'small', 'other', 'unknown')),

  -- Cash-vs-accrual is NOT one switch: a cash-basis tax regime can still need
  -- receivables, payables and statutory accrual accounts, and the VAT tax point
  -- follows its own rules. Stored separately for that reason.
  --
  -- Recorded, not asked. The application posts revenue on the invoice date and
  -- costs when incurred — accrual is what the ledger actually does, so this is a
  -- statement of fact about the software rather than a tenant preference. Letting
  -- a band select 'cash' would record a basis the books do not follow. Supporting
  -- another basis is a change to revenue recognition, and that change would set
  -- this column; the enum keeps the other values available for it.
  financial_accounting_basis TEXT NOT NULL DEFAULT 'accrual'
    CONSTRAINT tap_financial_basis_known
    CHECK (financial_accounting_basis IN ('accrual', 'cash', 'simplified', 'unknown')),
  vat_accounting_basis TEXT NOT NULL DEFAULT 'unknown'
    CONSTRAINT tap_vat_basis_known
    CHECK (vat_accounting_basis IN ('invoice', 'cash', 'not_applicable', 'unknown')),

  reporting_framework_code TEXT,

  -- Arbitrary financial-year start. Stored as month+day rather than a date so it
  -- is year-independent. The CHECK below rejects 29 February and other
  -- non-existent combinations: a financial year must start on a date that exists
  -- in every year, and the non-leap-year fallback policy is not one to imply.
  financial_year_start_month SMALLINT NOT NULL DEFAULT 1
    CONSTRAINT tap_fy_start_month_range CHECK (financial_year_start_month BETWEEN 1 AND 12),
  financial_year_start_day SMALLINT NOT NULL DEFAULT 1
    CONSTRAINT tap_fy_start_day_range CHECK (financial_year_start_day BETWEEN 1 AND 31),

  base_currency TEXT NOT NULL
    CONSTRAINT tap_base_currency_format CHECK (base_currency ~ '^[A-Z]{3}$'),

  -- Tri-state on purpose. NULL is "not yet confirmed", which is different from a
  -- confirmed "not registered": scheme participation is a legal fact supplied by
  -- the user or their accountant, never inferred from turnover.
  vat_registered BOOLEAN,

  -- 'exempt' is the small-business case and is NOT the same as 'not_applicable':
  -- a band on the Dutch KOR (or an equivalent national scheme) IS registered for
  -- VAT and holds a VAT number, but the scheme relieves it of charging VAT and of
  -- filing periodic returns. 'not_applicable' means the band is not registered at
  -- all. Collapsing the two would misstate the tenant's status to the authority.
  vat_filing_frequency TEXT NOT NULL DEFAULT 'unconfigured'
    CONSTRAINT tap_vat_filing_frequency_known
    CHECK (vat_filing_frequency IN (
      'monthly', 'quarterly', 'yearly', 'authority_assigned',
      'exempt', 'not_applicable', 'unconfigured'
    )),

  -- Reserved for the country-pack installer; NULL until packs exist.
  pack_version TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tap_financial_year_start_valid CHECK (
    financial_year_start_day <= CASE financial_year_start_month
      WHEN 2 THEN 28
      WHEN 4 THEN 30
      WHEN 6 THEN 30
      WHEN 9 THEN 30
      WHEN 11 THEN 30
      ELSE 31
    END
  )
);

-- No DB constraint couples vat_registered to the two VAT fields: the settings UI
-- saves one field per request, so intermediate states must be storable. The
-- coupling is enforced by a cascade in accountingProfileService (setting
-- vat_registered rewrites the dependent fields in the same transaction) and by
-- the completeness rule.

-- Backfill every existing tenant. 'incomplete' AND 'legacy_backfill': these
-- values were inherited from defaults, not chosen, and most required fields are
-- still unset. financial_year_start_* take the 1/1 default, which is exactly what
-- the existing period code already assumes, so nothing changes for them.
--
-- tenants.tax_percentage is deliberately NOT copied: the default VAT rate stays
-- single-owner on tenants until its readers are repointed. A second copy now
-- would be precisely the divergence this staged rollout exists to prevent.
INSERT INTO tenant_accounting_profiles (
  tenant_id, country_code, base_currency, legal_form, profile_source, profile_status
)
SELECT
  id,
  vat_country,
  CASE WHEN vat_country = 'gb' THEN 'GBP' ELSE 'EUR' END,
  legal_form,
  'legacy_backfill',
  'incomplete'
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;
