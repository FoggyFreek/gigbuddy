// Preflight for migration 166 (band/artist plan audience split).
//
// Before the split, nothing stopped a user scheduling a cross-product plan
// change — `gold → artist_gold` classified as an ordinary downgrade. Migration
// 166 derives `subscriptions.audience` from the CURRENT plan, which would leave
// such a `pending_plan_id` stranded: a pending target the new model cannot
// represent, and which the deploy-B trigger will reject outright.
//
// This script only reports. Clearing the rows in SQL is NOT safe: a pending
// downgrade may already own a remote Mollie replacement schedule
// (`downgrade_schedule_pending`, `superseded_mollie_subscription_id`), and a
// blind wipe orphans it at the provider. The operator resolves each row through
// the app — cancelling the pending change runs cancelRemoteSubscription
// properly — and migration 166 then RAISEs if any remain.
//
//   --check   report only, exits 2 when any cross-audience pending change exists
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pool from '../../../db/index.js'
import { logger } from '../../../utils/logger.js'
import { PLAN_AUDIENCES } from '../../../../shared/planAudiences.js'

function legacyPlanAudience(plan) {
  const bands = plan?.entitlements?.limits?.bands
  return !plan?.is_fallback && bands === 0 ? PLAN_AUDIENCES.ARTIST : PLAN_AUDIENCES.BAND
}

// Reads the audience column when it exists (post-166 re-runs) and otherwise
// derives the audience migration 166 WILL assign, so the same script is valid
// on both sides of the migration.
async function hasAudienceColumn(executor) {
  const { rowCount } = await executor.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'subscription_plans' AND column_name = 'audience'`,
  )
  return rowCount > 0
}

export async function findCrossAudiencePending(executor) {
  const columnExists = await hasAudienceColumn(executor)
  const audienceExpr = columnExists ? 'p.audience' : 'NULL::text'
  const pendingAudienceExpr = columnExists ? 'pp.audience' : 'NULL::text'

  const { rows } = await executor.query(
    `SELECT s.id, s.user_id, s.status,
            p.slug AS plan_slug, ${audienceExpr} AS plan_audience,
            p.is_fallback AS plan_is_fallback, p.entitlements AS plan_entitlements,
            pp.slug AS pending_plan_slug, ${pendingAudienceExpr} AS pending_plan_audience,
            pp.is_fallback AS pending_is_fallback, pp.entitlements AS pending_entitlements
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
       JOIN subscription_plans pp ON pp.id = s.pending_plan_id
      WHERE s.status <> 'canceled' AND s.pending_plan_id IS NOT NULL
      ORDER BY s.id ASC`,
  )

  return rows
    .map((row) => ({
      subscriptionId: row.id,
      userId: row.user_id,
      status: row.status,
      planSlug: row.plan_slug,
      pendingPlanSlug: row.pending_plan_slug,
      audience: row.plan_audience
        ?? legacyPlanAudience({ is_fallback: row.plan_is_fallback, entitlements: row.plan_entitlements }),
      pendingAudience: row.pending_plan_audience
        ?? legacyPlanAudience({ is_fallback: row.pending_is_fallback, entitlements: row.pending_entitlements }),
    }))
    .filter((row) => row.audience !== row.pendingAudience)
}

export async function auditCrossAudiencePending(executor) {
  const offenders = await findCrossAudiencePending(executor)
  return { offenders, counts: { crossAudiencePending: offenders.length }, ok: offenders.length === 0 }
}

function reportDetails(result) {
  for (const row of result.offenders) {
    logger.warn('cross_audience_pending.found', {
      operation: 'cross_audience_pending',
      subscriptionId: row.subscriptionId,
      userId: row.userId,
      status: row.status,
      planSlug: row.planSlug,
      audience: row.audience,
      pendingPlanSlug: row.pendingPlanSlug,
      pendingAudience: row.pendingAudience,
    })
  }
}

const USAGE = 'Usage: node server/commerce/billing/scripts/checkCrossAudiencePending.js --check'

export function parseArgs(argv) {
  if (argv.length !== 1 || argv[0] !== '--check') throw new Error(USAGE)
  return { apply: false }
}

async function main() {
  parseArgs(process.argv.slice(2))
  const result = await auditCrossAudiencePending(pool)
  reportDetails(result)
  logger.info('cross_audience_pending.completed', { mode: 'check', ...result.counts })
  if (!result.ok) process.exitCode = 2
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (err) {
    logger.error('cross_audience_pending.failed', { err })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
