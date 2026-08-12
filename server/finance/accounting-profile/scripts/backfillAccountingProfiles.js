// Consistency audit + repair for tenant_accounting_profiles.
//
// The ONLY repair path: a missing profile is a 409 accounting_profile_missing,
// never created lazily.
//
//   --check                              report only, exits 2 when inconsistent
//   --apply                              fill missing default VAT rates
//   --apply --tenant=<id> --country=<cc> insert the profile for one tenant
//
// Two faults:
//   missing profile        nothing records a jurisdiction for it and one is never
//                          guessed, so the repair takes an explicit --country.
//   missing default rate   rate-dependent reads would produce NaN. The profile's
//                          own country_code fills it, so --apply repairs in bulk.
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pool from '../../../db/index.js'
import { logger } from '../../../utils/logger.js'
import {
  findTenantsWithoutProfile,
  findProfilesMissingDefaultVatRate,
  countProfilesBySource,
  insertAccountingProfile,
  updateAccountingProfile,
} from '../accountingProfileRepository.js'
import { defaultBaseCurrency } from '../../../../shared/accountingProfileCodes.js'
import { getStandardVatRate, isKnownVatCountry, normalizeVatCountry } from '../../../../shared/vatRates.js'

export async function auditAccountingProfiles(executor, { apply = false, repairTenant = null } = {}) {
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
    // Only when named: the country is the operator's assertion about that band.
    if (repairTenant) {
      if (!missing.some((row) => row.tenant_id === repairTenant.tenantId)) {
        throw new Error(`Tenant ${repairTenant.tenantId} has no missing profile to repair`)
      }
      const inserted = await insertAccountingProfile(executor, repairTenant.tenantId, {
        country_code: repairTenant.countryCode,
        base_currency: defaultBaseCurrency(repairTenant.countryCode),
        default_vat_rate: getStandardVatRate(repairTenant.countryCode),
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

  // A still-missing profile keeps the run non-ok, so a repair run cannot read as
  // "all clean" while work remains.
  const ok = counts.migrationNeeded - counts.migrated === 0
    && (apply || counts.rateMissing === 0)
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
    // 'repair' rows had their country supplied by hand — worth a human look.
    const level = row.profile_source === 'repair' ? 'warn' : 'info'
    logger[level]('accounting_profile_audit.source', {
      operation: row.profile_source, tenants: row.count,
    })
  }
}

const USAGE = 'Usage: node server/finance/accounting-profile/scripts/backfillAccountingProfiles.js --check'
  + ' | --apply [--tenant=<id> --country=<cc>]'

export function parseArgs(argv) {
  const mode = argv[0]
  if (mode !== '--check' && mode !== '--apply') throw new Error(USAGE)

  const rest = argv.slice(1)
  if (mode === '--check' && rest.length) throw new Error(USAGE)

  const flags = new Map()
  for (const arg of rest) {
    const match = /^--(tenant|country)=(.+)$/.exec(arg)
    if (!match) throw new Error(USAGE)
    flags.set(match[1], match[2])
  }
  if (!flags.size) return { apply: mode === '--apply', repairTenant: null }
  if (flags.size !== 2) throw new Error('--tenant and --country must be given together')

  const tenantId = Number(flags.get('tenant'))
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error('--tenant must be a positive integer')

  const countryCode = normalizeVatCountry(flags.get('country'))
  if (!isKnownVatCountry(countryCode)) throw new Error(`Unsupported --country: ${flags.get('country')}`)

  return { apply: true, repairTenant: { tenantId, countryCode } }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = await auditAccountingProfiles(pool, options)
  reportDetails(result)
  logger.info('accounting_profile_audit.completed', {
    mode: options.apply ? 'apply' : 'check', ...result.counts,
  })
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
