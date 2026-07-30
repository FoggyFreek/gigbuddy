-- The tenant's VAT SCHEME HISTORY: which small-business or cross-border regime
-- applied, and between which dates.
--
-- Until now the entire notion of a VAT scheme was one boolean,
-- `tenants.applies_kor`, gated to the Netherlands by korApplies(). That column
-- cannot answer "which scheme", cannot answer "since when", and cannot hold two
-- schemes at once — while the cross-border EU SME scheme is per DESTINATION
-- member state and coexists with a national one, and nine other packs have
-- national exemptions of their own. Migration 137 deliberately left this out
-- (see its header): scheme identity needs effective-dated enrolments plus
-- issued-document snapshots to be correct, and 141 supplies the second half.
--
-- This migration is ADDITIVE ONLY. Deployment runs migrations while the previous
-- app container is still serving (`docker compose run --rm migrate` before
-- `docker compose up -d app`), so `tenants.applies_kor` keeps working and keeps
-- being read until a later deployment drops it. From now on it is a PROJECTION
-- of this table, written only by the enrolment service and its reconciler.

CREATE TABLE IF NOT EXISTS tax_scheme_enrolments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- For a national scheme this is the tenant's own accounting country. For an
  -- EU SME enrolment it is the DESTINATION member state the exemption was
  -- granted in, which is why it participates in the open-enrolment key below.
  country_code TEXT NOT NULL
    CONSTRAINT tse_country_code_supported
    CHECK (country_code IN ('nl', 'be', 'de', 'fr', 'lu', 'at', 'es', 'it', 'ie', 'gb')),

  -- Deliberately no CHECK. A hardcoded list cannot carry ten country packs, and
  -- retiring a code from the registry must never break the historical rows that
  -- reference it. Validation lives in taxSchemeEnrolmentValidators against
  -- shared/taxSchemes.js, which is the pack-owned source of truth.
  scheme_code TEXT NOT NULL,

  -- What the enrolment GOVERNS, stored rather than derived. The cross-border EU
  -- SME scheme must stay separate from a national one: a destination-country
  -- exemption never stops the tenant's home VAT returns. This column is what
  -- makes "the scheme in force domestically" a single unambiguous row instead of
  -- an ORDER BY guess, and future dimensions (OSS, sector schemes) add a scope
  -- value rather than more ambiguity.
  scheme_scope TEXT NOT NULL
    CONSTRAINT tse_scheme_scope_known
    CHECK (scheme_scope IN ('national_home', 'eu_sme_destination')),

  valid_from DATE NOT NULL,
  -- INCLUSIVE last day. Tax authorities state end dates inclusively ("your KOR
  -- ends 31 December 2025"), so a half-open column would be silently
  -- mistranslated by every user typing the date off their letter. Every range
  -- predicate in the codebase reads `valid_to >= $date`, and there is exactly one
  -- place that writes it (taxSchemeEnrolmentRepository).
  valid_to DATE,

  -- Provenance, orthogonal to the dates. 'legacy_inferred' means the row was
  -- derived from the old boolean during this migration: we can prove the band is
  -- on the scheme NOW, never when it joined. Confirming a start date promotes it.
  status TEXT NOT NULL
    CONSTRAINT tse_status_known
    CHECK (status IN ('confirmed', 'legacy_inferred')),
  source_confirmation_date DATE,

  -- Corrections are forward-only, matching the ledger. A confirmed enrolment is
  -- the evidence explaining why an issued document's snapshot says what it says,
  -- so it is voided rather than deleted; resolution never reads a voided row.
  voided_at TIMESTAMPTZ,
  voided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  superseded_by_id BIGINT REFERENCES tax_scheme_enrolments(id) ON DELETE SET NULL,

  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tse_range_valid CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT tse_id_tenant_id_key UNIQUE (id, tenant_id)
);

-- At most one OPEN enrolment per (tenant, country, scheme): a band cannot be
-- twice on the same scheme in the same jurisdiction. Per-destination EU SME rows
-- coexist because they differ in country_code.
CREATE UNIQUE INDEX IF NOT EXISTS tse_open_enrolment_key
  ON tax_scheme_enrolments (tenant_id, country_code, scheme_code)
  WHERE valid_to IS NULL AND voided_at IS NULL;

-- And at most one open HOME-NATIONAL enrolment per tenant, full stop. This is
-- what makes "the domestic scheme in force on date D" unambiguous structurally,
-- rather than by ORDER BY luck in the query.
CREATE UNIQUE INDEX IF NOT EXISTS tse_open_home_scheme_key
  ON tax_scheme_enrolments (tenant_id)
  WHERE valid_to IS NULL AND voided_at IS NULL AND scheme_scope = 'national_home';

CREATE INDEX IF NOT EXISTS tse_tenant_range
  ON tax_scheme_enrolments (tenant_id, valid_from DESC, id DESC);

-- Overlap between CLOSED ranges is enforced in the service, under the per-tenant
-- accounting advisory lock the profile and settings already share. A real
-- EXCLUDE USING gist (… daterange(valid_from, valid_to, '[]') WITH &&) needs the
-- btree_gist extension, which the deploy role may not be able to create — the
-- schema must not depend on it. The two partial indexes above cover the open
-- cases, which are the ones a concurrent request can actually race.

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Every row is 'legacy_inferred' on purpose. The old boolean records that a band
-- is on the scheme today; it says nothing about when it joined, and no backfill
-- can invent that. valid_from is therefore set to the earliest date the
-- enrolment MUST cover so that migration 141 leaves no issued document
-- unresolved — not a claim about the real start date, which the user confirms in
-- the settings UI.
-- ---------------------------------------------------------------------------

-- 1. NL bands carrying the old applies_kor flag.
INSERT INTO tax_scheme_enrolments (
  tenant_id, country_code, scheme_code, scheme_scope, valid_from, valid_to, status
)
SELECT
  t.id,
  'nl',
  'nl_kor',
  'national_home',
  LEAST(
    t.created_at::date,
    COALESCE((SELECT MIN(COALESCE(i.supply_date, i.issue_date)) FROM invoices  i WHERE i.tenant_id = t.id), t.created_at::date),
    COALESCE((SELECT MIN(p.receipt_date)                        FROM purchases p WHERE p.tenant_id = t.id), t.created_at::date)
  ),
  NULL,
  'legacy_inferred'
FROM tenants t
WHERE t.applies_kor IS TRUE
  AND t.vat_country = 'nl'
  AND NOT EXISTS (
    SELECT 1 FROM tax_scheme_enrolments e
     WHERE e.tenant_id = t.id AND e.valid_to IS NULL AND e.voided_at IS NULL
       AND e.scheme_scope = 'national_home'
  );

-- 2. Non-NL bands that chose "exempt" as their filing frequency in step 1. That
-- setting only warned that VAT suppression was not implemented for their
-- jurisdiction; it never set applies_kor. Without a row here their filing
-- frequency would be backed by no enrolment at all once it becomes derived.
INSERT INTO tax_scheme_enrolments (
  tenant_id, country_code, scheme_code, scheme_scope, valid_from, valid_to, status
)
SELECT
  p.tenant_id,
  p.country_code,
  s.scheme_code,
  'national_home',
  LEAST(
    t.created_at::date,
    COALESCE((SELECT MIN(COALESCE(i.supply_date, i.issue_date)) FROM invoices  i WHERE i.tenant_id = t.id), t.created_at::date),
    COALESCE((SELECT MIN(pu.receipt_date)                       FROM purchases pu WHERE pu.tenant_id = t.id), t.created_at::date)
  ),
  NULL,
  'legacy_inferred'
FROM tenant_accounting_profiles p
JOIN tenants t ON t.id = p.tenant_id
JOIN (VALUES
  ('be', 'be_franchise'),
  ('de', 'de_kleinunternehmer'),
  ('at', 'at_kleinunternehmer'),
  ('fr', 'fr_franchise_en_base'),
  ('lu', 'lu_franchise'),
  ('it', 'it_forfettario')
) AS s(country_code, scheme_code) ON s.country_code = p.country_code
WHERE p.vat_filing_frequency = 'exempt'
  AND NOT EXISTS (
    SELECT 1 FROM tax_scheme_enrolments e
     WHERE e.tenant_id = p.tenant_id AND e.valid_to IS NULL AND e.voided_at IS NULL
       AND e.scheme_scope = 'national_home'
  );
