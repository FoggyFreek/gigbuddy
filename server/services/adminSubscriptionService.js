// Super-admin subscription management: complimentary grants/revocations and the
// operator listing (with schedule-stale / repair-needed surfacing). Complimentary
// subscriptions carry no provider objects and no billing periods; they are
// excluded from every Mollie-touching task and cannot be self-managed by the
// user (billingService returns complimentary_managed_by_admin).
import { fetchPlan } from '../repositories/planRepository.js'
import {
  fetchLiveSubscriptionForUser,
  fetchSubscriptionByIdForUpdate,
  insertSubscription,
  cancelSubscriptionNow,
  listSubscriptionsForAdmin,
} from '../repositories/subscriptionRepository.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { serializeSubscription } from './billingService.js'
import { parseComplimentaryBody } from '../validators/billingValidators.js'
import { dispatchUserNotification, pushUserNotification } from './notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../domain/notificationTypes.js'
import { logger } from '../utils/logger.js'
import { badRequest } from './serviceErrors.js'

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
  // Per-ladder: a band subscriber can still be granted an artist plan, which is
  // the point of granting one as a perk.
  if (await fetchLiveSubscriptionForUser(db, userId, plan.audience)) {
    return { error: { status: 409, body: { error: 'User already has a subscription', code: 'already_subscribed' } } }
  }
  try {
    const sub = await insertSubscription(db, {
      user_id: userId,
      plan_id: planId,
      status: 'active',
      price_cents: 0,
      is_complimentary: true,
      complimentary_expires_at: expiresAt,
    })
    await notifyGranted(userId, plan, expiresAt, sub.id)
    return { subscription: serializeSubscription({ ...sub, plan_slug: plan.slug }) }
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'User already has a subscription', code: 'already_subscribed' } } }
    }
    throw err
  }
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
      ...serializeSubscription(row),
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      createdAt: row.created_at,
    })),
  }
}
