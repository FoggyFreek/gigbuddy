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
       tenant_id, country_code, base_currency, legal_form, profile_source, profile_status
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id) DO NOTHING
     RETURNING *`,
    [
      tenantId,
      profile.country_code,
      profile.base_currency,
      profile.legal_form ?? null,
      profile.profile_source,
      profile.profile_status,
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

// Tenants with no profile row, and tenants whose profile country disagrees with
// the legacy tenants.vat_country projection. Drives the audit script that gates
// dropping the legacy columns.
export async function findProfileInconsistencies(executor) {
  const { rows } = await executor.query(
    `SELECT t.id AS tenant_id,
            t.slug,
            t.vat_country,
            p.country_code,
            p.profile_source,
            (p.tenant_id IS NULL) AS missing
       FROM tenants t
       LEFT JOIN tenant_accounting_profiles p ON p.tenant_id = t.id
      WHERE p.tenant_id IS NULL
         OR p.country_code <> t.vat_country
      ORDER BY t.id`,
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
