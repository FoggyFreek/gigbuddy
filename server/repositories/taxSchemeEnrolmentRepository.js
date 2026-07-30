// SQL for tax_scheme_enrolments — the tenant's VAT scheme history. No business
// decisions here; every function takes an executor (pool or transaction client)
// first so callers control transactions, and every query is tenant-scoped.
//
// The per-tenant advisory lock these rows are written under lives in
// accountRepository.js (ACCOUNTING_SETTINGS_LOCK_NAMESPACE), shared with the
// accounting profile, the accounting settings and ledger postings: they are one
// logical accounting configuration.
//
// This module is the SOLE OWNER of the "in force on date D" predicate. It is
// built once, below, and every query composes it — because `valid_to` is
// INCLUSIVE and a second hand-written copy is exactly how the two halves of an
// interval convention drift apart. shared/taxSchemes.js carries the JS mirror
// (enrolmentCoversDate) and a test asserts the two agree on both boundary days.

// `$${n}` is the date parameter; voided rows are never resolved through, since
// corrections are forward-only.
function inForce(paramIndex) {
  return `voided_at IS NULL
          AND valid_from <= $${paramIndex}
          AND (valid_to IS NULL OR valid_to >= $${paramIndex})`
}

// Overlap between two inclusive closed ranges, with NULL meaning "open ended" on
// either side. Mirrors inForce(): [aFrom, aTo] ∩ [bFrom, bTo] ≠ ∅.
function overlapsRange(fromParam, toParam) {
  return `voided_at IS NULL
          AND ($${toParam}::date IS NULL OR valid_from <= $${toParam}::date)
          AND (valid_to IS NULL OR valid_to >= $${fromParam}::date)`
}

export async function fetchEnrolment(executor, tenantId, id) {
  const { rows } = await executor.query(
    'SELECT * FROM tax_scheme_enrolments WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  )
  return rows[0] || null
}

export async function listSchemeEnrolments(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT * FROM tax_scheme_enrolments
      WHERE tenant_id = $1
      ORDER BY valid_from DESC, id DESC`,
    [tenantId],
  )
  return rows
}

// The DOMESTIC scheme in force at a date. Scoped to national_home so an open
// per-destination EU SME enrolment can never hijack the home treatment, and to
// the tenant's own accounting country. tse_open_home_scheme_key guarantees at
// most one open home row, so this is unambiguous by construction rather than by
// ORDER BY luck — the ordering below only breaks ties between CLOSED historical
// ranges, which the service already prevents from overlapping.
export async function fetchHomeSchemeEnrolmentOn(executor, tenantId, countryCode, isoDate) {
  const { rows } = await executor.query(
    `SELECT * FROM tax_scheme_enrolments
      WHERE tenant_id = $1
        AND country_code = $2
        AND scheme_scope = 'national_home'
        AND ${inForce(3)}
      ORDER BY valid_from DESC, id DESC
      LIMIT 1`,
    [tenantId, countryCode, isoDate],
  )
  return rows[0] || null
}

// Any enrolment of the same (country, scheme) whose range touches [from, to].
export async function fetchOverlapping(executor, tenantId, countryCode, schemeCode, from, to, { excludeId = null } = {}) {
  const { rows } = await executor.query(
    `SELECT * FROM tax_scheme_enrolments
      WHERE tenant_id = $1
        AND country_code = $2
        AND scheme_code = $3
        AND ($6::bigint IS NULL OR id <> $6::bigint)
        AND ${overlapsRange(4, 5)}
      ORDER BY valid_from
      LIMIT 1`,
    [tenantId, countryCode, schemeCode, from, to, excludeId],
  )
  return rows[0] || null
}

// A tenant cannot hold two DIFFERENT home schemes over the same days either —
// the open-row index only covers the open case.
export async function fetchOverlappingHomeScheme(executor, tenantId, from, to, { excludeId = null } = {}) {
  const { rows } = await executor.query(
    `SELECT * FROM tax_scheme_enrolments
      WHERE tenant_id = $1
        AND scheme_scope = 'national_home'
        AND ($4::bigint IS NULL OR id <> $4::bigint)
        AND ${overlapsRange(2, 3)}
      ORDER BY valid_from
      LIMIT 1`,
    [tenantId, from, to, excludeId],
  )
  return rows[0] || null
}

export async function insertSchemeEnrolment(executor, tenantId, enrolment) {
  const { rows } = await executor.query(
    `INSERT INTO tax_scheme_enrolments (
       tenant_id, country_code, scheme_code, scheme_scope,
       valid_from, valid_to, status, source_confirmation_date, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      tenantId,
      enrolment.country_code,
      enrolment.scheme_code,
      enrolment.scheme_scope,
      enrolment.valid_from,
      enrolment.valid_to ?? null,
      enrolment.status,
      enrolment.source_confirmation_date ?? null,
      enrolment.created_by_user_id ?? null,
    ],
  )
  return rows[0] || null
}

// Idempotent variant for the TEMPORARY lazy compatibility repair (see
// vatTreatmentService): a concurrent insert lands in ON CONFLICT DO NOTHING and
// the caller re-reads. The conflict target is the open-home-scheme index.
export async function insertHomeSchemeEnrolmentIfAbsent(executor, tenantId, enrolment) {
  const { rows } = await executor.query(
    `INSERT INTO tax_scheme_enrolments (
       tenant_id, country_code, scheme_code, scheme_scope, valid_from, valid_to, status
     )
     SELECT $1, $2, $3, 'national_home', $4, NULL, $5
      WHERE NOT EXISTS (
        SELECT 1 FROM tax_scheme_enrolments
         WHERE tenant_id = $1 AND valid_to IS NULL AND voided_at IS NULL
           AND scheme_scope = 'national_home'
      )
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [tenantId, enrolment.country_code, enrolment.scheme_code, enrolment.valid_from, enrolment.status],
  )
  return rows[0] || null
}

// `updates` keys are whitelisted by the validator/service.
export async function updateSchemeEnrolment(executor, tenantId, id, updates) {
  const keys = Object.keys(updates)
  const sets = keys.map((k, i) => `${k} = $${i + 3}`)
  sets.push('updated_at = NOW()')
  const { rows } = await executor.query(
    `UPDATE tax_scheme_enrolments SET ${sets.join(', ')}
      WHERE id = $1 AND tenant_id = $2 AND voided_at IS NULL
      RETURNING *`,
    [id, tenantId, ...keys.map((k) => updates[k])],
  )
  return rows[0] || null
}

export async function voidSchemeEnrolment(executor, tenantId, id, { reason, actorUserId, supersededById = null }) {
  const { rows } = await executor.query(
    `UPDATE tax_scheme_enrolments
        SET voided_at = NOW(), voided_by_user_id = $3, void_reason = $4,
            superseded_by_id = $5, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND voided_at IS NULL
      RETURNING *`,
    [id, tenantId, actorUserId ?? null, reason ?? null, supersededById],
  )
  return rows[0] || null
}

export async function deleteSchemeEnrolment(executor, tenantId, id) {
  const { rows } = await executor.query(
    'DELETE FROM tax_scheme_enrolments WHERE id = $1 AND tenant_id = $2 RETURNING id',
    [id, tenantId],
  )
  return rows.length > 0
}

// Whether any ISSUED document's tax point falls inside an enrolment's range —
// the "nothing depends on this row" test that gates a hard delete. Issued, not
// merely finalized: applyStatusFields stamps finalized_at on draft → void too,
// and an abandoned draft was never issued.
export async function hasIssuedDocumentInRange(executor, tenantId, from, to) {
  const { rows } = await executor.query(
    `SELECT EXISTS (
       SELECT 1 FROM invoices i
        WHERE i.tenant_id = $1
          AND COALESCE(i.supply_date, i.issue_date) >= $2::date
          AND ($3::date IS NULL OR COALESCE(i.supply_date, i.issue_date) <= $3::date)
          AND (i.status IN ('sent', 'paid')
               OR EXISTS (SELECT 1 FROM ledger_transactions lt
                           WHERE lt.tenant_id = i.tenant_id AND lt.source_type = 'invoice'
                             AND lt.source_id = i.id AND lt.source_event = 'sent'))
     ) OR EXISTS (
       SELECT 1 FROM purchases p
        WHERE p.tenant_id = $1
          AND p.receipt_date >= $2::date
          AND ($3::date IS NULL OR p.receipt_date <= $3::date)
          AND p.status IN ('approved', 'paid')
     ) AS referenced`,
    [tenantId, from, to],
  )
  return rows[0].referenced
}

// Tenants whose derived `vat_filing_frequency` disagrees with the home enrolment
// in force TODAY. Drives both the reconciler (a scheduled enrolment makes a
// write-time derivation stale on its boundary date) and the audit script.
export async function listProjectionDrift(executor) {
  const { rows } = await executor.query(
    `SELECT t.id AS tenant_id,
            t.slug,
            p.country_code,
            p.vat_filing_frequency,
            e.scheme_code AS active_scheme_code,
            (e.id IS NOT NULL) AS expected_exempt
       FROM tenants t
       JOIN tenant_accounting_profiles p ON p.tenant_id = t.id
       LEFT JOIN LATERAL (
         SELECT * FROM tax_scheme_enrolments s
          WHERE s.tenant_id = t.id
            AND s.country_code = p.country_code
            AND s.scheme_scope = 'national_home'
            AND s.voided_at IS NULL
            AND s.valid_from <= CURRENT_DATE
            AND (s.valid_to IS NULL OR s.valid_to >= CURRENT_DATE)
          ORDER BY s.valid_from DESC, s.id DESC
          LIMIT 1
       ) e ON TRUE
      WHERE (p.vat_filing_frequency = 'exempt') <> (e.id IS NOT NULL)
      ORDER BY t.id`,
  )
  return rows
}

// Enrolments of the same (country, scheme) whose ranges overlap, and tenants
// holding two overlapping home schemes. Both are service-enforced invariants
// with no DB constraint behind the closed-range case, so the audit checks them.
export async function listOverlappingEnrolments(executor) {
  const { rows } = await executor.query(
    `SELECT a.tenant_id, a.id AS enrolment_id, b.id AS other_enrolment_id,
            a.scheme_code, b.scheme_code AS other_scheme_code, a.scheme_scope
       FROM tax_scheme_enrolments a
       JOIN tax_scheme_enrolments b
         ON b.tenant_id = a.tenant_id
        AND b.id > a.id
        AND b.voided_at IS NULL
        AND (
          (a.scheme_scope = 'national_home' AND b.scheme_scope = 'national_home')
          OR (a.country_code = b.country_code AND a.scheme_code = b.scheme_code)
        )
        AND (b.valid_to IS NULL OR a.valid_from <= b.valid_to)
        AND (a.valid_to IS NULL OR b.valid_from <= a.valid_to)
      WHERE a.voided_at IS NULL
      ORDER BY a.tenant_id, a.id`,
  )
  return rows
}
