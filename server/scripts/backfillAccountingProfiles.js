// Consistency audit + repair for tenant_accounting_profiles.
//
// This is now the ONLY repair path: the app no longer creates a profile lazily
// on read, it reports 409 accounting_profile_missing instead.
//
// --check reports and exits 2 when anything is inconsistent (no writes).
// --apply repairs missing rows and missing default VAT rates.
//
// Two faults are checked:
//   missing profile        a tenant with no profile row. Only possible for a
//                          tenant created before the profile became mandatory,
//                          so tenants.vat_country is the country it was really
//                          created with and --apply may derive from it. Once
//                          that column is dropped this repair needs the country
//                          supplied by hand.
//   missing default rate   migration 142 added default_vat_rate; a profile
//                          inserted during that migration's window has none, and
//                          every rate-dependent read would produce NaN.
//
// The former country-mismatch check is gone: tenants.vat_country is no longer
// written, so every band created after that change disagrees with it by
// construction. Reconciling the two was the gate for THIS step and had to pass
// before it shipped.
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pool from '../db/index.js'
import { logger } from '../utils/logger.js'
import {
  findTenantsWithoutProfile,
  findProfilesMissingDefaultVatRate,
  countProfilesBySource,
  insertAccountingProfile,
  updateAccountingProfile,
} from '../repositories/accountingProfileRepository.js'
import { defaultBaseCurrency } from '../../shared/accountingProfileCodes.js'
import { getStandardVatRate } from '../../shared/vatRates.js'

export async function auditAccountingProfiles(executor, { apply = false } = {}) {
  const missing = await findTenantsWithoutProfile(executor)
  const missingRate = await findProfilesMissingDefaultVatRate(executor)

  const counts = {
    tenants: 0,
    migrationNeeded: missing.length,
    rateMissing: missingRate.length,
    migrated: 0,
    ratesFilled: 0,
  }

  const bySource = await countProfilesBySource(executor)
  counts.tenants = bySource.reduce((total, row) => total + row.count, 0)

  if (apply) {
    for (const row of missing) {
      const inserted = await insertAccountingProfile(executor, row.tenant_id, {
        country_code: row.vat_country,
        base_currency: defaultBaseCurrency(row.vat_country),
        default_vat_rate: getStandardVatRate(row.vat_country),
        legal_form: null,
        profile_source: 'repair',
        profile_status: 'incomplete',
      })
      if (inserted) counts.migrated += 1
    }
    for (const row of missingRate) {
      await updateAccountingProfile(executor, row.tenant_id, {
        default_vat_rate: getStandardVatRate(row.country_code),
      })
      counts.ratesFilled += 1
    }
  }

  const ok = apply || (counts.migrationNeeded === 0 && counts.rateMissing === 0)
  return { counts, ok, missing, missingRate, bySource }
}

function reportDetails(result) {
  for (const row of result.missing) {
    logger.warn('accounting_profile_audit.missing', {
      tenantId: row.tenant_id, operation: 'missing_profile',
    })
  }
  for (const row of result.missingRate) {
    logger.warn('accounting_profile_audit.missing_default_rate', {
      tenantId: row.tenant_id, operation: 'missing_default_vat_rate',
    })
  }
  for (const row of result.bySource) {
    // 'repair' rows had their country derived rather than chosen — worth a human
    // look before the legacy column they were derived from is dropped.
    const level = row.profile_source === 'repair' ? 'warn' : 'info'
    logger[level]('accounting_profile_audit.source', {
      operation: row.profile_source, tenants: row.count,
    })
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !['--check', '--apply'].includes(args[0])) {
    throw new Error('Usage: node server/scripts/backfillAccountingProfiles.js --check|--apply')
  }
  const result = await auditAccountingProfiles(pool, { apply: args[0] === '--apply' })
  reportDetails(result)
  logger.info('accounting_profile_audit.completed', { mode: args[0].slice(2), ...result.counts })
  if (!result.ok) process.exitCode = 2
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (err) {
    logger.error('accounting_profile_audit.failed', { err })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
