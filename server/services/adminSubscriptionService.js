// Super-admin subscription management: complimentary grants/revocations and the
// operator listing (with schedule-stale / repair-needed surfacing). Complimentary
// subscriptions carry no provider objects and no billing periods; they are
// excluded from every Mollie-touching task and cannot be self-managed by the
// user (billingService returns complimentary_managed_by_admin).
import { fetchPlan } from '../repositories/planRepository.js'
import {
  fetchLiveSubscriptionForUser,
  fetchLiveSubscriptionForUpdate,
  insertSubscription,
  cancelSubscriptionNow,
  listSubscriptionsForAdmin,
} from '../repositories/subscriptionRepository.js'
import { serializeSubscription } from './billingService.js'
import { parseComplimentaryBody } from '../validators/billingValidators.js'
import { dispatchUserNotification, pushUserNotification } from './notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from './notificationTypes.js'
import { logger } from '../utils/logger.js'

function badRequest(error, code) {
  return { error: { status: 400, body: { error, ...(code ? { code } : {}) } } }
}

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
  if (await fetchLiveSubscriptionForUser(db, userId)) {
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

export async function revokeComplimentary(db, userId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub || !sub.is_complimentary) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'No complimentary subscription' } } }
    }
    await cancelSubscriptionNow(client, sub.id, 'admin_revoked')
    await client.query('COMMIT')
    return { revoked: true }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
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
