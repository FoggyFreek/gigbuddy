// What every billing write does AFTER its transaction commits: bring the next
// renewal's amount and the provider schedule back in step with local state.
//
// Always on the global pool, never the caller's client — the transaction is
// gone by now. Always fire-and-forget: the scheduler repairs whatever fails
// here, so a provider hiccup must not fail the customer's request.
import pool from '../../db/index.js'
import { repriceSubscription } from './subscriptionPricingService.js'
import { repairSchedule } from './billingSaga.js'
import { logger } from '../../utils/logger.js'

// `logKey` names the flow that asked, so the log still says which path failed.
export async function repairScheduleSafely(subId, logKey = 'billing.repair_schedule_failed') {
  await repairSchedule(pool, subId).catch((err) =>
    logger.error(logKey, { err, subscriptionId: subId }))
}

export async function repriceAndRepairSchedule(subId) {
  await repriceSubscription(pool, subId).catch((err) =>
    logger.error('billing.reprice_failed', { err, subscriptionId: subId }))
  await repairScheduleSafely(subId)
}
