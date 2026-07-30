// Consistency audit + repair for tenant_accounting_profiles.
//
// Migration 137 backfills a profile for every tenant that existed when it ran.
// Deployment migrates while the PREVIOUS app container is still serving
// (`docker compose run --rm migrate` before `docker compose up -d app`), so that
// container can still create a tenant afterwards without a profile row. The app
// repairs such a row lazily on read; this script is the operator-side view of the
// same problem and the gate for dropping the legacy tenants columns.
//
// --check reports and exits 2 when anything is inconsistent (no writes).
// --apply repairs missing rows, deriving the country from tenants.vat_country.
//
// Country MISMATCHES are never auto-repaired: whether the profile or the legacy
// column is right is a judgement call about the tenant's real jurisdiction, and
// guessing would silently change a tax jurisdiction. They are reported for a human.
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pool from '../db/index.js'
import { logger } from '../utils/logger.js'
import {
  findProfileInconsistencies,
  countProfilesBySource,
  insertAccountingProfile,
} from '../repositories/accountingProfileRepository.js'
import { defaultBaseCurrency } from '../../shared/accountingProfileCodes.js'
import { getStandardVatRate } from '../../shared/vatRates.js'

export async function auditAccountingProfiles(executor, { apply = false } = {}) {
  const inconsistencies = await findProfileInconsistencies(executor)
  const missing = inconsistencies.filter((row) => row.missing)
  const mismatched = inconsistencies.filter((row) => !row.missing)

  const counts = {
    tenants: 0,
    conflicts: mismatched.length,
    migrationNeeded: missing.length,
    migrated: 0,
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
  }

  // A mismatch always fails: it must be resolved by a human, not by this script.
  // Missing rows only fail in --check mode, since --apply just fixed them.
  const ok = counts.conflicts === 0 && (apply || counts.migrationNeeded === 0)
  return { counts, ok, missing, mismatched, bySource }
}

function reportDetails(result) {
  for (const row of result.missing) {
    logger.warn('accounting_profile_audit.missing', {
      tenantId: row.tenant_id, operation: 'missing_profile',
    })
  }
  for (const row of result.mismatched) {
    logger.error('accounting_profile_audit.country_mismatch', {
      tenantId: row.tenant_id, operation: 'country_mismatch',
    })
  }
  for (const row of result.bySource) {
    logger.info('accounting_profile_audit.source', {
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
