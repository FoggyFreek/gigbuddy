// SQL for the tenant accounting profile (the regime record). No business
// decisions here; every function takes an executor (pool or transaction client)
// first so callers control transactions, and every query is tenant-scoped.
//
// The per-tenant advisory lock this table is written under lives in
// accountRepository.js (ACCOUNTING_SETTINGS_LOCK_NAMESPACE): the profile and
// tenant_accounting_settings are one logical accounting configuration, and
// ledger postings already take that lock, so a second namespace would let a
// posting proceed against a half-changed configuration.

export async function fetchAccountingProfile(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM tenant_accounting_profiles WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0] || null
}

// Idempotent by design: the repair path can race another request for the same
// tenant, and a conflict there is harmless (the caller re-reads). Returns the
// inserted row, or null when a row already existed.
export async function insertAccountingProfile(executor, tenantId, profile) {
  const { rows } = await executor.query(
    `INSERT INTO tenant_accounting_profiles (
       tenant_id, country_code, base_currency, default_vat_rate, legal_form, profile_source, profile_status,
       pack_version
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id) DO NOTHING
     RETURNING *`,
    [
      tenantId,
      profile.country_code,
      profile.base_currency,
      profile.default_vat_rate,
      profile.legal_form ?? null,
      profile.profile_source,
      profile.profile_status,
      profile.pack_version ?? null,
    ],
  )
  return rows[0] || null
}

// `updates` keys are whitelisted by the validator (patchable profile fields plus
// the service-computed profile_status).
export async function updateAccountingProfile(executor, tenantId, updates) {
  const keys = Object.keys(updates)
  const sets = keys.map((k, i) => `${k} = $${i + 2}`)
  sets.push('updated_at = NOW()')
  const { rows } = await executor.query(
    `UPDATE tenant_accounting_profiles SET ${sets.join(', ')}
     WHERE tenant_id = $1 RETURNING *`,
    [tenantId, ...keys.map((k) => updates[k])],
  )
  return rows[0] || null
}

// Records that a human confirmed the inherited/entered values. Only ever set for
// a complete profile (checked by the service).
export async function markProfileReviewed(executor, tenantId, userId) {
  const { rows } = await executor.query(
    `UPDATE tenant_accounting_profiles
        SET reviewed_at = NOW(), reviewed_by_user_id = $2, updated_at = NOW()
      WHERE tenant_id = $1 RETURNING *`,
    [tenantId, userId],
  )
  return rows[0] || null
}

// Tenants with no profile row. Nothing on the tenant row records a country, so
// repairing one takes an operator supplying it explicitly.
export async function findTenantsWithoutProfile(executor) {
  const { rows } = await executor.query(
    `SELECT t.id AS tenant_id, t.slug
       FROM tenants t
       LEFT JOIN tenant_accounting_profiles p ON p.tenant_id = t.id
      WHERE p.tenant_id IS NULL
      ORDER BY t.id`,
  )
  return rows
}

// Profiles with no default VAT rate: migration 142 added the column and
// backfilled it, but a profile inserted during that migration's window has none,
// and every rate-dependent read would produce NaN.
export async function findProfilesMissingDefaultVatRate(executor) {
  const { rows } = await executor.query(
    `SELECT tenant_id, country_code
       FROM tenant_accounting_profiles
      WHERE default_vat_rate IS NULL
      ORDER BY tenant_id`,
  )
  return rows
}

export async function countProfilesBySource(executor) {
  const { rows } = await executor.query(
    `SELECT profile_source, COUNT(*)::int AS count
       FROM tenant_accounting_profiles
      GROUP BY profile_source
      ORDER BY profile_source`,
  )
  return rows
}

export async function countFinancialDocuments(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT
       (SELECT COUNT(*)::int FROM invoices WHERE tenant_id = $1) AS invoices,
       (SELECT COUNT(*)::int FROM purchases WHERE tenant_id = $1) AS purchases,
       (SELECT COUNT(*)::int FROM ledger_transactions WHERE tenant_id = $1) AS journals,
       (SELECT COUNT(*)::int FROM reimbursements WHERE tenant_id = $1) AS reimbursements,
       (SELECT COUNT(*)::int FROM vat_returns WHERE tenant_id = $1) AS vat_returns,
       (SELECT COUNT(*)::int FROM merch_sales WHERE tenant_id = $1) AS merch_sales,
       (SELECT COUNT(*)::int FROM bank_statement_imports WHERE tenant_id = $1) AS bank_imports`,
    [tenantId],
  )
  return rows[0]
}

export async function resetProfileCountry(executor, tenantId, {
  countryCode,
  baseCurrency,
  defaultVatRate,
  packVersion,
}) {
  const { rows } = await executor.query(
    `UPDATE tenant_accounting_profiles
        SET country_code = $2,
            base_currency = $3,
            default_vat_rate = $4,
            legal_form = NULL,
            local_legal_form_code = NULL,
            local_legal_form_label = NULL,
            reporting_framework_code = NULL,
            vat_registered = NULL,
            vat_accounting_basis = 'unknown',
            vat_filing_frequency = 'unconfigured',
            profile_status = 'incomplete',
            reviewed_at = NULL,
            reviewed_by_user_id = NULL,
            pack_version = $5,
            updated_at = NOW()
      WHERE tenant_id = $1
      RETURNING *`,
    [tenantId, countryCode, baseCurrency, defaultVatRate, packVersion ?? null],
  )
  return rows[0] || null
}

export async function voidCountryDependentEnrolments(executor, tenantId, userId) {
  const { rowCount } = await executor.query(
    `UPDATE tax_scheme_enrolments
        SET voided_at = NOW(),
            voided_by_user_id = $2,
            void_reason = 'accounting_country_changed',
            updated_at = NOW()
      WHERE tenant_id = $1
        AND voided_at IS NULL
        AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
    [tenantId, userId],
  )
  return rowCount
}

export async function resetProductVatRates(executor, tenantId, defaultVatRate) {
  const { rowCount } = await executor.query(
    `UPDATE products
        SET vat_rate = $2, updated_at = NOW()
      WHERE tenant_id = $1 AND vat_rate IS DISTINCT FROM $2`,
    [tenantId, defaultVatRate],
  )
  return rowCount
}
