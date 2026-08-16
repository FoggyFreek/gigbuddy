// Refunds. Two entry points, one mechanism:
//
//   - Self-service withdrawal: within REFUND_WINDOW_DAYS of the charge that
//     OPENED the current period, cancelling ends access immediately and refunds
//     that charge in full.
//   - Super-admin grant: a partial refund of any settled payment, for support
//     cases handled out of band.
//
// The local refund row is committed BEFORE the provider call (same rule as
// every other remote mutation), so a crash mid-refund is a resumable intent
// rather than lost money. The provider call itself runs through the outbox.
import pool from '../../db/index.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import {
  fetchLiveSubscriptionForUpdate,
  fetchSubscriptionById,
  cancelSubscriptionNow,
} from './subscriptionRepository.js'
import {
  fetchPaymentByMollieIdForUpdate,
  fetchPaymentById,
} from './subscriptionPaymentRepository.js'
import {
  insertRefund,
  markRefundSucceeded,
  markRefundFailed,
  sumRefundedForPayment,
  listRefundsForSubscription,
} from './subscriptionRefundRepository.js'
import { cancelRemoteSubscription, refundSubscriptionPayment } from './billingSaga.js'
import { dispatchUserNotification, pushUserNotification } from '../../user/notifications/notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../../domain/notificationTypes.js'
import { refundWindowEndsAt, REFUND_WINDOW_DAYS } from './billingShared.js'
import { PaymentProviderError, PAYMENT_STATUS } from './paymentProvider/index.js'
import { logger } from '../../utils/logger.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'

const NO_SUBSCRIPTION = notFound('No subscription')
const COMPLIMENTARY = conflict('This subscription is managed by an administrator', {
  code: 'complimentary_managed_by_admin',
})

export { listRefundsForSubscription, REFUND_WINDOW_DAYS }

function withinWindow(sub, now = new Date()) {
  const until = refundWindowEndsAt(sub.last_charge_at)
  return Boolean(until && until > now)
}

// Runs the provider call for a committed refund intent and records the outcome.
// Never inside a transaction.
async function executeRefund(sub, refund, providerPaymentId, description) {
  try {
    const { refundId } = await refundSubscriptionPayment(pool, sub, {
      providerPaymentId, amountCents: refund.amount_cents, description,
    })
    await markRefundSucceeded(pool, refund.id, refundId)
    return { ok: true, refundId }
  } catch (err) {
    // A terminal provider rejection is a real failure the operator must see; a
    // retryable one stays 'pending' for the scheduler to resume, so it is NOT
    // marked failed here.
    if (err instanceof PaymentProviderError && !err.retryable) {
      await markRefundFailed(pool, refund.id).catch(() => {})
    }
    logger.error('billing.refund_failed', { err, subscriptionId: sub.id })
    return { ok: false }
  }
}

async function notifyRefunded(sub, amountCents) {
  const title = 'Subscription canceled and refunded'
  const body = `Your subscription has ended and the last payment (${(amountCents / 100).toFixed(2)} EUR) is being refunded.`
  const { inserted } = await dispatchUserNotification({
    userId: sub.user_id,
    type: BILLING_NOTIFICATION_TYPES.REFUNDED,
    title, body, url: '/billing',
    dedupeKey: `billing-refunded:${sub.id}:${sub.last_charge_payment_id}`,
  })
  if (inserted) {
    pushUserNotification(sub.user_id, {
      type: BILLING_NOTIFICATION_TYPES.REFUNDED, title, body, url: '/billing',
    })
  }
}

// The withdrawal path: cancel now, refund the cycle-opening charge in full.
// Access ends the moment the row is canceled — the resolver reads status, not
// the scheduler. NOTHING is purged: a cancellation is a lapse, and a lapse
// never deletes data.
export async function cancelWithRefund(db, userId) {
  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (!withinWindow(sub)) {
      abortTransaction(conflict(
        `Immediate cancellation with a refund is only available within ${REFUND_WINDOW_DAYS} days of a payment`,
        { code: 'refund_window_closed' },
      ))
    }
    if (sub.pending_payment_id) {
      abortTransaction(conflict('A change is in progress', { code: 'plan_change_in_progress' }))
    }

    const payment = await fetchPaymentByMollieIdForUpdate(client, sub.last_charge_payment_id)
    if (!payment || payment.status !== PAYMENT_STATUS.PAID) {
      abortTransaction(conflict('That payment cannot be refunded', { code: 'payment_not_refundable' }))
    }
    const already = await sumRefundedForPayment(client, payment.id)
    if (already >= payment.amount_cents) {
      abortTransaction(conflict('That payment has already been refunded', { code: 'already_refunded' }))
    }

    const refund = await insertRefund(client, {
      subscriptionId: sub.id,
      subscriptionPaymentId: payment.id,
      amountCents: payment.amount_cents - already,
      reason: 'withdrawal_window',
    })
    await cancelSubscriptionNow(client, sub.id, 'user_requested')
    return { sub, refund, providerPaymentId: payment.mollie_payment_id }
  }, { db })

  if (outcome.error) return outcome

  const { sub, refund, providerPaymentId } = outcome
  await cancelRemoteSubscription(pool, sub).catch((err) =>
    logger.error('billing.cancel_remote_failed', { err, subscriptionId: sub.id }))
  const result = await executeRefund(sub, refund, providerPaymentId, 'GigBuddy cancellation refund')
  await notifyRefunded(sub, refund.amount_cents)

  logger.info('billing.canceled_with_refund', { subscriptionId: sub.id })
  return {
    canceled: true,
    atPeriodEnd: false,
    refunded: result.ok,
    refundAmountCents: refund.amount_cents,
  }
}

// Super-admin partial refund. The subscription is NOT canceled — this is the
// support path for a customer who reached out by other means.
export async function grantAdminRefund(db, subscriptionId, { paymentId, amountCents, note }, actingUserId) {
  const outcome = await withTransaction(async (client) => {
    const sub = await fetchSubscriptionById(client, subscriptionId)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)

    const payment = await fetchPaymentById(client, paymentId)
    if (!payment || payment.subscription_id !== sub.id) {
      abortTransaction(notFound('Payment not found'))
    }
    if (payment.status !== PAYMENT_STATUS.PAID) {
      abortTransaction(conflict('That payment cannot be refunded', { code: 'payment_not_refundable' }))
    }
    // Locked so a concurrent refund cannot push the total over the payment.
    await fetchPaymentByMollieIdForUpdate(client, payment.mollie_payment_id)
    const already = await sumRefundedForPayment(client, payment.id)
    if (already + amountCents > payment.amount_cents) {
      abortTransaction(badRequest(
        `Only ${(payment.amount_cents - already) / 100} EUR is left to refund on this payment`,
        { code: 'refund_exceeds_payment' },
      ))
    }

    const refund = await insertRefund(client, {
      subscriptionId: sub.id,
      subscriptionPaymentId: payment.id,
      amountCents,
      reason: 'admin_grant',
      note,
      requestedByUserId: actingUserId,
    })
    return { sub, refund, providerPaymentId: payment.mollie_payment_id }
  }, { db })

  if (outcome.error) return outcome

  const { sub, refund, providerPaymentId } = outcome
  const result = await executeRefund(sub, refund, providerPaymentId, 'GigBuddy support refund')
  logger.info('billing.admin_refund', { subscriptionId: sub.id })
  return { refunded: result.ok, refundId: refund.id, amountCents: refund.amount_cents }
}
