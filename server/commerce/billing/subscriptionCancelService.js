// Cancelling and resuming. The immediate (withdrawal-window) path lives in
// subscriptionRefundService.js — it moves money, so it owns that decision.
import pool from '../../db/index.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import {
  fetchLiveSubscriptionForUpdate,
  setCancelAtPeriodEnd,
  clearCancelAtPeriodEnd,
  cancelSubscriptionNow,
  setScheduleStale,
} from './subscriptionRepository.js'
import { fetchPaymentByMollieId } from './subscriptionPaymentRepository.js'
import { cancelRemoteSubscription } from './billingSaga.js'
import { repairScheduleSafely } from './billingPostCommit.js'
import { cancelWithRefund } from './subscriptionRefundService.js'
import { PAYMENT_STATUS } from './paymentProvider/statuses.js'
import { parseCancel } from './billingValidators.js'
import { COMPLIMENTARY, NO_SUBSCRIPTION } from './billingErrors.js'
import { logger } from '../../utils/logger.js'
import { badRequest, conflict } from '../../platform/http/serviceErrors.js'

async function isPendingChargeNonterminal(executor, sub) {
  if (!sub.pending_payment_id) return false
  const payment = await fetchPaymentByMollieId(executor, sub.pending_payment_id)
  return Boolean(payment && (payment.status === PAYMENT_STATUS.OPEN || payment.status === PAYMENT_STATUS.PENDING))
}

export async function cancelSubscription(db, userId, body) {
  const parsed = parseCancel(body)
  if (parsed.error) return badRequest(parsed.error)

  if (parsed.immediate) return cancelWithRefund(db, userId)

  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (sub.cancel_at_period_end) return { alreadyScheduled: true }

    // A change mid-flight must not be stranded (a settling charge would take
    // money for a subscription about to cancel).
    if (await isPendingChargeNonterminal(client, sub)) {
      abortTransaction(conflict('A change is in progress', { code: 'plan_change_in_progress' }))
    }

    const hasPaidPeriod = sub.status === 'active' && sub.current_period_end
      && new Date(sub.current_period_end) > new Date()
    if (hasPaidPeriod) {
      await setCancelAtPeriodEnd(client, sub.id, 'user_requested')
    } else {
      // Trial / not-yet-activated / past_due: nothing paid to honor — cancel now.
      await cancelSubscriptionNow(client, sub.id, 'user_requested')
    }
    return { canceled: true, atPeriodEnd: hasPaidPeriod, sub }
  }, { db })

  if (!outcome.canceled) return outcome

  await cancelRemoteSubscription(pool, outcome.sub).catch((err) =>
    logger.error('billing.cancel_remote_failed', { err, subscriptionId: outcome.sub.id }))
  return { canceled: true, atPeriodEnd: outcome.atPeriodEnd }
}

export async function resumeSubscription(db, userId) {
  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (!sub.cancel_at_period_end) abortTransaction(badRequest('Nothing to resume'))
    if (sub.current_period_end && new Date(sub.current_period_end) <= new Date()) {
      abortTransaction(conflict('The subscription period has already ended', { code: 'already_ended' }))
    }
    await clearCancelAtPeriodEnd(client, sub.id)
    await setScheduleStale(client, sub.id, true) // recreate the provider schedule
    return { resumed: true, subId: sub.id }
  }, { db })

  if (!outcome.resumed) return outcome

  await repairScheduleSafely(outcome.subId, 'billing.resume_repair_failed')
  return { resumed: true }
}
