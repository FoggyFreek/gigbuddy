-- Freezes the VAT treatment of an ISSUED document onto the document itself.
--
-- Until now nothing about an issued invoice was frozen except its customer block
-- and its totals: both renderers re-derived the VAT treatment from LIVE tenant
-- state on every render (tenant.applies_kor, tenant.vat_country), the stored PDF
-- was re-rendered by POST /invoices/:id/render with no guard, and the UBL was
-- generated fresh on every download. Change the scheme today and a two-year-old
-- invoice's VAT treatment, exemption note and document language changed with it.
--
-- Effective-dated enrolments (migration 140) do NOT fix that on their own: a
-- backdated or corrected enrolment still moves an old re-render. Persisting the
-- resolved OUTCOME is what makes historical output immutable.
--
-- Which is why these columns store the outcome and not a scheme code to be
-- re-interpreted. A country pack will later flip a scheme from "recorded only" to
-- implemented; that must not move a document issued years earlier. Nothing reads
-- a historical row back through shared/taxSchemes.js.
--
-- ADDITIVE ONLY, and deliberately WITHOUT a CHECK requiring the snapshot on an
-- issued row: deployment migrates while the previous app container is still
-- serving, and that container issues invoices without writing these columns — the
-- constraint would make its writes fail. Completeness is enforced by the service,
-- repaired lazily on read, and reported by scripts/auditVatSchemeSnapshots.js.
-- The constraint lands once only new code writes.

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

ALTER TABLE invoices
  -- The accounting jurisdiction the document was issued under. Drives the VAT
  -- label, the registration labels and the document language at render time.
  ADD COLUMN IF NOT EXISTS accounting_country_snapshot TEXT,

  -- PROVENANCE: which scheme enrolment was in force. NULL means none, i.e. the
  -- standard regime. This may legitimately DISAGREE with the treatment below —
  -- a scheme that is recorded but not implemented leaves the treatment
  -- 'standard', because that is what the software actually did. The audit
  -- reports the size of that population rather than hiding it.
  ADD COLUMN IF NOT EXISTS vat_scheme_code_snapshot TEXT,

  -- THE OUTCOME. Vocabulary from the country-pack spec §5.4; a small-business
  -- exemption is deliberately not a zero rate, since the two differ in
  -- input-VAT credit and in return boxes.
  ADD COLUMN IF NOT EXISTS vat_treatment_snapshot TEXT
    CONSTRAINT invoices_vat_treatment_snapshot_known
    CHECK (vat_treatment_snapshot IS NULL OR vat_treatment_snapshot IN (
      'standard', 'reduced', 'zero_rated', 'exempt_no_credit',
      'outside_scope', 'reverse_charge', 'small_business_exempt'
    )),

  -- The effective outcome with reverse charge included, so a renderer never has
  -- to recombine the two.
  ADD COLUMN IF NOT EXISTS charges_output_vat_snapshot BOOLEAN,

  -- Which rule set decided the above. Recorded for audit and for explaining a
  -- past resolution; NO render path branches on it. The immutability comes from
  -- persisting the outcome, not from versioning the rules.
  ADD COLUMN IF NOT EXISTS vat_treatment_version SMALLINT,

  -- Immutability keys on THIS, not on finalized_at. 'issued' and 'confirmed'
  -- rows are frozen; a 'legacy_inferred' row is this migration's best reading of
  -- the evidence and stays correctable until a human confirms it.
  ADD COLUMN IF NOT EXISTS vat_snapshot_source TEXT
    CONSTRAINT invoices_vat_snapshot_source_known
    CHECK (vat_snapshot_source IS NULL OR vat_snapshot_source IN (
      'issued', 'legacy_inferred', 'confirmed'
    )),

  -- Every existing invoice was rendered in EUR (the renderers hardcoded it), so
  -- the default states a fact rather than assuming one. Non-EUR only becomes
  -- reachable when the reports, the money formatter and the payment flows are
  -- currency-aware.
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'
    CONSTRAINT invoices_currency_format CHECK (currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- Purchases
--
-- A DIFFERENT fact from the sales side. Under a small-business exemption the
-- supplier still charges VAT and the buyer simply cannot deduct it (spec §9.4:
-- "do not deduct input VAT while the treatment applies"). So a purchase records
-- RECOVERABILITY, and no scheme ever alters a purchase's amounts: purchases.
-- tax_cents is what the supplier charged.
--
-- Note the known divergence this column exists to make fixable: postBillAccrued
-- still debits the input-VAT account for every purchase, including an enrolled
-- tenant's. Changing that is a ledger behavior change needing a correction path,
-- so this migration records the fact and the audit reports the population.
-- purchases.currency already exists (migration 063).
-- ---------------------------------------------------------------------------

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS accounting_country_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vat_scheme_code_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vat_treatment_snapshot TEXT
    CONSTRAINT purchases_vat_treatment_snapshot_known
    CHECK (vat_treatment_snapshot IS NULL OR vat_treatment_snapshot IN (
      'standard', 'reduced', 'zero_rated', 'exempt_no_credit',
      'outside_scope', 'reverse_charge', 'small_business_exempt'
    )),
  ADD COLUMN IF NOT EXISTS input_vat_recoverable_snapshot BOOLEAN,
  ADD COLUMN IF NOT EXISTS vat_treatment_version SMALLINT,
  ADD COLUMN IF NOT EXISTS vat_snapshot_source TEXT
    CONSTRAINT purchases_vat_snapshot_source_known
    CHECK (vat_snapshot_source IS NULL OR vat_snapshot_source IN (
      'issued', 'legacy_inferred', 'confirmed'
    ));

-- ---------------------------------------------------------------------------
-- Backfill: ISSUED, not finalized — and evidence, not inference
--
-- `finalized_at` is stamped on ANY move off draft, including draft -> void
-- (applyStatusFields in invoiceService). An abandoned draft was never issued and
-- must get no snapshot. The predicate below is status sent/paid OR an existing
-- invoice/sent ledger transaction; the second clause catches an invoice that was
-- issued and later voided, which must keep its snapshot.
--
-- The DOCUMENT'S OWN TOTALS are the primary evidence and outrank the tenant's
-- current scheme. invoices.tax_cents is exactly what postInvoiceSent credited to
-- the output-VAT account, so it IS the ledger evidence. Backfilling a
-- VAT-charging invoice as exempt because the band is on KOR *today* would freeze
-- a claim we can see is false.
--
-- CONSEQUENCE, which is deliberate: for a KOR band with historical invoices
-- carrying positive tax_cents, those invoices render VAT-zeroed today (the
-- renderer recomputes from live applies_kor) and will render WITH VAT after this
-- migration — because that is what they were issued as and what the ledger
-- recorded. Run auditVatSchemeSnapshots.js --check BEFORE migrating to enumerate
-- exactly which invoices that is.
-- ---------------------------------------------------------------------------

-- `implemented` is hardcoded to nl_kor rather than read from the registry, and
-- that is correct HERE precisely because a migration is frozen in time: it must
-- describe what the software did up to this point, not what a later country pack
-- will do. Only the Dutch KOR ever suppressed VAT (korApplies in
-- shared/vatRates.js). A scheme that was merely recorded suppressed nothing, so
-- it cannot explain a zero — such an invoice was standard-rated with zero-rate
-- or zero-amount lines.
-- Resolved in a CTE rather than UPDATE ... FROM: the LATERAL has to correlate on
-- each invoice's own tax point, and the UPDATE target is not in scope for a
-- FROM-clause lateral.
WITH resolved AS (
  SELECT i.id,
         i.tax_cents,
         i.reverse_charge,
         t.vat_country,
         e.scheme_code,
         COALESCE(e.implemented, FALSE) AS implemented
    FROM invoices i
    JOIN tenants t ON t.id = i.tenant_id
    LEFT JOIN LATERAL (
      SELECT s.scheme_code, (s.scheme_code = 'nl_kor') AS implemented
        FROM tax_scheme_enrolments s
       WHERE s.tenant_id = i.tenant_id
         AND s.country_code = t.vat_country
         AND s.scheme_scope = 'national_home'
         AND s.voided_at IS NULL
         AND s.valid_from <= COALESCE(i.supply_date, i.issue_date)
         AND (s.valid_to IS NULL OR s.valid_to >= COALESCE(i.supply_date, i.issue_date))
       ORDER BY s.valid_from DESC, s.id DESC
       LIMIT 1
    ) e ON TRUE
   WHERE i.accounting_country_snapshot IS NULL
     AND (
       i.status IN ('sent', 'paid')
       OR EXISTS (
         SELECT 1 FROM ledger_transactions lt
          WHERE lt.tenant_id = i.tenant_id
            AND lt.source_type = 'invoice'
            AND lt.source_id = i.id
            AND lt.source_event = 'sent'
       )
     )
)
UPDATE invoices i SET
  accounting_country_snapshot = r.vat_country,
  vat_scheme_code_snapshot = r.scheme_code,
  vat_treatment_snapshot = CASE
    WHEN r.reverse_charge THEN 'reverse_charge'
    -- Charged VAT: standard, whatever the scheme says now.
    WHEN r.tax_cents > 0 THEN 'standard'
    -- No VAT and an IMPLEMENTED exempt scheme covering the tax point: the scheme
    -- is what explains the zero.
    WHEN r.implemented THEN 'small_business_exempt'
    ELSE 'standard'
  END,
  charges_output_vat_snapshot = (NOT r.reverse_charge AND r.tax_cents > 0),
  vat_treatment_version = 1,
  vat_snapshot_source = 'legacy_inferred'
FROM resolved r
WHERE r.id = i.id;

-- Purchases: approved or paid. No amount is inspected — a positive tax_cents
-- under an exemption is the NORMAL case, not a conflict.
WITH resolved AS (
  SELECT p.id,
         t.vat_country,
         e.scheme_code,
         COALESCE(e.implemented, FALSE) AS implemented
    FROM purchases p
    JOIN tenants t ON t.id = p.tenant_id
    LEFT JOIN LATERAL (
      SELECT s.scheme_code, (s.scheme_code = 'nl_kor') AS implemented
        FROM tax_scheme_enrolments s
       WHERE s.tenant_id = p.tenant_id
         AND s.country_code = t.vat_country
         AND s.scheme_scope = 'national_home'
         AND s.voided_at IS NULL
         AND s.valid_from <= p.receipt_date
         AND (s.valid_to IS NULL OR s.valid_to >= p.receipt_date)
       ORDER BY s.valid_from DESC, s.id DESC
       LIMIT 1
    ) e ON TRUE
   WHERE p.accounting_country_snapshot IS NULL
     AND p.status IN ('approved', 'paid')
)
UPDATE purchases p SET
  accounting_country_snapshot = r.vat_country,
  vat_scheme_code_snapshot = r.scheme_code,
  vat_treatment_snapshot = CASE WHEN r.implemented THEN 'small_business_exempt' ELSE 'standard' END,
  input_vat_recoverable_snapshot = NOT r.implemented,
  vat_treatment_version = 1,
  vat_snapshot_source = 'legacy_inferred'
FROM resolved r
WHERE r.id = p.id;
