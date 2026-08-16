// Super-admin subscription management: complimentary grants/revocations and the
// operator listing (with schedule-stale / repair-needed surfacing). Complimentary
// subscriptions carry no provider objects and no billing periods; they are
// excluded from every Mollie-touching task and cannot be self-managed by the
// user (billingService returns complimentary_managed_by_admin).
import { fetchPlan } from '../../commerce/plans/planRepository.js'
import {
  fetchLiveSubscriptionForUser,
  fetchSubscriptionByIdForUpdate,
  insertSubscription,
  cancelSubscriptionNow,
  listSubscriptionsForAdmin,
} from '../../commerce/billing/subscriptionRepository.js'
import {
  insertModule,
  listModules,
} from '../../commerce/billing/subscriptionModuleRepository.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { serializeSubscription } from '../../commerce/billing/billingService.js'
import { grantAdminRefund, listRefundsForSubscription } from '../../commerce/billing/subscriptionRefundService.js'
import { parseComplimentaryBody, parseAdminRefund } from '../../commerce/billing/billingValidators.js'
import { dispatchUserNotification, pushUserNotification } from '../../user/notifications/notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../../domain/notificationTypes.js'
import { logger } from '../../utils/logger.js'
import { badRequest } from '../../platform/http/serviceErrors.js'

// Best-effort: the grant itself must not fail because a notification couldn't
// be written or pushed.
async function notifyGranted(userId, plan, expiresAt, subscriptionId) {
  const type = BILLING_NOTIFICATION_TYPES.COMPLIMENTARY_GRANTED
  const title = 'Complimentary access granted'
  const until = expiresAt ? ` until ${expiresAt.toISOString().slice(0, 10)}` : ''
  const body = `You have been granted complimentary access to the ${plan.name} plan${until}.`
  try {
    const { inserted } = await dispatchUserNotification({
      userId, type, title, body, url: '/billing', dedupeKey: `billing-complimentary-granted:${subscriptionId}`,
    })
    if (inserted) pushUserNotification(userId, { type, title, body, url: '/billing' })
  } catch (err) {
    logger.error('billing.complimentary_notify_failed', { err, subscriptionId })
  }
}

export async function grantComplimentary(db, body) {
  const parsed = parseComplimentaryBody(body)
  if (parsed.error) return badRequest(parsed.error)
  const { userId, planId, expiresAt } = parsed

  const plan = await fetchPlan(db, planId)
  if (!plan || !plan.is_active) return { error: { status: 404, body: { error: 'Plan not found' } } }
  if (plan.is_fallback) return badRequest('The free plan needs no grant')
  // One subscription per user now, so a grant is refused outright rather than
  // per ladder. To add a second module to a live grant, grant it again after
  // revoking — the operator path stays deliberately blunt.
  if (await fetchLiveSubscriptionForUser(db, userId)) {
    return { error: { status: 409, body: { error: 'User already has a subscription', code: 'already_subscribed' } } }
  }
  const conflictResult = {
    error: { status: 409, body: { error: 'User already has a subscription', code: 'already_subscribed' } },
  }
  const result = await withTransaction(async (client) => {
    const sub = await insertSubscription(client, {
      user_id: userId,
      status: 'active',
      is_complimentary: true,
      complimentary_expires_at: expiresAt,
      total_cents: 0,
    })
    // A complimentary subscription is still a module subscription — that is what
    // makes the entitlement resolver treat it like any other.
    await insertModule(client, {
      subscription_id: sub.id, plan_id: planId, status: 'active', price_cents: 0, is_starter: true,
    })
    return { sub, modules: await listModules(client, sub.id) }
  }, { db, mapError: (err) => (err.code === '23505' ? conflictResult : null) })

  if (result.error) return result
  await notifyGranted(userId, plan, expiresAt, result.sub.id)
  return { subscription: serializeSubscription(result.sub, result.modules) }
}

// Keyed on the subscription id, not the user: a user may hold a complimentary
// grant on each ladder, and the admin table already renders one row per
// subscription. The user id is still checked so an id from another account
// cannot be revoked through the wrong URL.
export async function revokeComplimentary(db, userId, subscriptionId) {
  if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    return badRequest('subscriptionId must be a positive integer')
  }
  return withTransaction(async (client) => {
    const sub = await fetchSubscriptionByIdForUpdate(client, subscriptionId)
    if (!sub || sub.user_id !== userId || !sub.is_complimentary || sub.status === 'canceled') {
      abortTransaction({ error: { status: 404, body: { error: 'No complimentary subscription' } } })
    }
    await cancelSubscriptionNow(client, sub.id, 'admin_revoked')
    return { revoked: true }
  }, { db })
}

export async function listSubscriptions(db, { repairOnly = false } = {}) {
  const rows = await listSubscriptionsForAdmin(db, { repairOnly })
  return {
    subscriptions: rows.map((row) => ({
      // The listing query aggregates modules as JSON rather than joining a plan,
      // so the operator sees the whole product mix in one row.
      ...serializeSubscription(row),
      modules: row.modules,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      createdAt: row.created_at,
    })),
  }
}

// Partial refunds are the documented support path: the customer reaches out by
// email or the support desk, and an operator grants what was agreed. The
// subscription itself is untouched.
export async function refundSubscription(db, subscriptionId, body, actingUserId) {
  if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    return badRequest('subscriptionId must be a positive integer')
  }
  const parsed = parseAdminRefund(body)
  if (parsed.error) return badRequest(parsed.error)
  return grantAdminRefund(db, subscriptionId, parsed, actingUserId)
}

export async function listSubscriptionRefunds(db, subscriptionId) {
  if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    return badRequest('subscriptionId must be a positive integer')
  }
  return { refunds: await listRefundsForSubscription(db, subscriptionId) }
}
