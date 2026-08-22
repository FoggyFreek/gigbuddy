// The /billing read model: what the page shows, and the manual reconcile behind
// the dev "sync" button. Read-only apart from the reconcile, which only replays
// idempotent ingestion.
import { listPlans } from '../plans/planRepository.js'
import {
  fetchLiveSubscriptionForUser,
  fetchSubscriptionById,
  hasUsedTrial,
} from './subscriptionRepository.js'
import { listModules } from './subscriptionModuleRepository.js'
import {
  fetchPaymentByMollieId,
  listNonterminalPaymentsForSubscription,
} from './subscriptionPaymentRepository.js'
import { ingestProviderPayment } from './paymentIngestionService.js'
import { countActiveOwnedTenants } from '../../entitlements/limitRepository.js'
import { repairScheduleSafely } from './billingPostCommit.js'
import { quoteIntervals, nextModuleSet } from './subscriptionPricingService.js'
import { priceForInterval, refundWindowEndsAt, TRIAL_DAYS } from './billingShared.js'
import { PAYMENT_STATUS } from './paymentProvider/statuses.js'
import { fetchPersonalTenant } from '../../people/workspaces/tenantRepository.js'
import { logger } from '../../utils/logger.js'

export function serializeSubscription(sub, modules = []) {
  if (!sub) return null
  const refundEligibleUntil = refundWindowEndsAt(sub.last_charge_at)
  return {
    id: sub.id,
    status: sub.status,
    billingInterval: sub.billing_interval,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    trialEndsAt: sub.trial_ends_at,
    convertedAt: sub.converted_at,
    isComplimentary: sub.is_complimentary,
    complimentaryExpiresAt: sub.complimentary_expires_at,
    priceSnapshot: sub.price_snapshot ?? null,
    totalCents: sub.total_cents ?? null,
    nextPriceSnapshot: sub.next_price_snapshot ?? null,
    nextTotalCents: sub.next_total_cents ?? null,
    pendingTotalCents: sub.pending_total_cents ?? null,
    // Inside this window a cancellation is immediate and refunds the charge
    // that opened the period, in full.
    refundEligibleUntil: refundEligibleUntil && refundEligibleUntil > new Date()
      ? refundEligibleUntil.toISOString() : null,
    scheduleStale: sub.mollie_schedule_stale,
    repairNeeded: sub.billing_repair_needed,
    paymentMethodReady: Boolean(sub.mollie_mandate_id),
    paymentVerificationPending: sub.status === 'trialing'
      && (sub.verification_payment_status === PAYMENT_STATUS.OPEN
        || sub.verification_payment_status === PAYMENT_STATUS.PENDING),
    subscriptionStartsAt: sub.status === 'trialing' && sub.mollie_subscription_id
      ? sub.trial_ends_at : null,
    modules: modules.map((m) => ({
      audience: m.audience,
      planId: m.plan_id,
      planSlug: m.plan_slug,
      status: m.status,
      priceCents: m.price_cents,
      isStarter: m.is_starter,
      pendingPlanId: m.pending_plan_id,
      pendingPlanSlug: m.pending_plan_slug,
      pendingChangeKind: m.pending_change_kind,
      pendingLimitsSnapshot: m.pending_limits_snapshot ?? null,
    })),
  }
}

export async function getBillingState(db, userId) {
  const sub = await fetchLiveSubscriptionForUser(db, userId)
  const [modules, ownedBandCount, personalTenant, trialUsed, plans, verificationPayment] = await Promise.all([
    sub ? listModules(db, sub.id) : Promise.resolve([]),
    countActiveOwnedTenants(db, userId),
    fetchPersonalTenant(db, userId),
    hasUsedTrial(db, userId),
    listPlans(db),
    sub?.mollie_first_payment_id
      ? fetchPaymentByMollieId(db, sub.mollie_first_payment_id)
      : Promise.resolve(null),
  ])
  let checkoutQuotes = { month: null, year: null }
  if (sub?.status === 'trialing' && modules.length > 0) {
    const selectedModules = nextModuleSet(modules)
    // Only an interval every selected plan is priced for can be quoted; the
    // others stay null.
    const intervals = ['month', 'year'].filter((interval) =>
      selectedModules.every(({ plan }) => priceForInterval(plan, interval) !== null))
    if (intervals.length > 0) {
      checkoutQuotes = {
        ...checkoutQuotes,
        ...await quoteIntervals(db, { modules: selectedModules, intervals }),
      }
    }
  }

  return {
    subscription: serializeSubscription(sub
      ? { ...sub, verification_payment_status: verificationPayment?.status ?? null }
      : null, modules),
    trialAvailable: !trialUsed && !sub,
    trialDays: TRIAL_DAYS,
    ownedBandCount,
    hasPersonalWorkspace: personalTenant !== null,
    checkoutQuotes,
    plans: plans.filter((p) => p.is_active),
  }
}

// Manual reconcile for the current user's subscription — the dev "sync" button
// when webhooks are disabled. Re-ingests every nonterminal payment and repairs
// a stale schedule. Safe to call anytime (ingestion is idempotent).
export async function syncOwnSubscription(db, userId) {
  const sub = await fetchLiveSubscriptionForUser(db, userId)
  if (!sub) return { subscription: null }

  for (const p of await listNonterminalPaymentsForSubscription(db, sub.id)) {
    await ingestProviderPayment(sub.id, p.mollie_payment_id).catch((err) =>
      logger.error('billing.sync_ingest_failed', { err, subscriptionId: sub.id }))
  }
  const current = await fetchSubscriptionById(db, sub.id)
  if (current?.mollie_schedule_stale) {
    await repairScheduleSafely(sub.id, 'billing.sync_repair_failed')
  }
  const fresh = await fetchLiveSubscriptionForUser(db, userId)
  return { subscription: serializeSubscription(fresh, fresh ? await listModules(db, fresh.id) : []) }
}
