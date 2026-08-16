// Conversion: price the chosen module set for an interval and open the hosted
// checkout. Two shapes share this file because they are the same decision seen
// from either side of the trial — a trialling customer pays only the disclosed
// verification cent now (the real combined charge is scheduled at trial end),
// while a customer whose trial is spent pays the full conversion charge.
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { fetchPlan } from '../plans/planRepository.js'
import {
  fetchLiveSubscriptionForUpdate,
  insertSubscription,
  setBillingInterval,
  setNextPriceSnapshot,
  setPendingPriceSnapshot,
} from './subscriptionRepository.js'
import {
  listModulesForUpdate,
  insertModule,
  setModulePrice,
  setModulePendingChange,
} from './subscriptionModuleRepository.js'
import {
  createConversionCheckout,
  createMandateVerificationCheckout,
} from './billingSaga.js'
import { computeModuleBlockers } from './moduleCapacityService.js'
import { quote, currentModuleSet, nextModuleSet } from './subscriptionPricingService.js'
import { priceForInterval, MANDATE_VERIFICATION_CENTS } from './billingShared.js'
import { isPlatformBillingConfigured } from './paymentProvider/providerFactory.js'
import { ProviderError } from './paymentProvider/ProviderError.js'
import { mergeEntitlements } from '../../auth/entitlements.js'
import { parseModuleSelection, parseCheckout } from './billingValidators.js'
import {
  COMPLIMENTARY,
  NOT_CONFIGURED,
  NO_SUBSCRIPTION,
  PROVIDER_ERROR,
} from './billingErrors.js'
import { badRequest, conflict } from '../../platform/http/serviceErrors.js'

// Prices the module set for the chosen interval. A trial pays only the disclosed
// verification cent now; its real combined charge is scheduled at trial end.
// A customer whose trial was already spent still pays the direct-signup
// conversion charge immediately.
export async function checkout(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parseCheckout(body)
  if (parsed.error) return badRequest(parsed.error)
  const { interval, redirect } = parsed

  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, user.id)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (sub.status === 'active' || sub.status === 'past_due') {
      abortTransaction(conflict('This subscription is already active', { code: 'already_active' }))
    }

    const modules = await listModulesForUpdate(client, sub.id)
    if (modules.length === 0) {
      abortTransaction(badRequest('Choose at least one module first', { code: 'no_modules' }))
    }
    const pricedModules = sub.status === 'trialing'
      ? nextModuleSet(modules)
      : currentModuleSet(modules)
    for (const { plan } of pricedModules) {
      if (priceForInterval(plan, interval) === null) {
        abortTransaction(badRequest('A chosen plan is not available for that interval', { code: 'plan_not_priced' }))
      }
    }

    const snapshot = await quote(client, { modules: pricedModules, interval })
    if (snapshot.totalCents <= 0) {
      abortTransaction(badRequest('This configuration is not available for the chosen interval', { code: 'plan_not_priced' }))
    }

    await setBillingInterval(client, sub.id, interval)
    for (const m of modules) {
      await setModulePrice(client, m.id, priceForInterval(m, interval))
      if (m.pending_change_kind === 'trial_selection') {
        const pendingPlan = {
          monthly_price_cents: m.pending_monthly_price_cents,
          yearly_price_cents: m.pending_yearly_price_cents,
        }
        await setModulePendingChange(client, m.id, {
          planId: m.pending_plan_id,
          kind: 'trial_selection',
          priceCents: priceForInterval(pendingPlan, interval),
        })
      }
    }
    if (sub.status === 'trialing') {
      // This is the exact amount the provider schedule will charge on the
      // displayed trial-end date. Nothing installs a paid period yet.
      await setNextPriceSnapshot(client, sub.id, { snapshot, totalCents: snapshot.totalCents })
      return { sub: { ...sub, billing_interval: interval }, snapshot, trial: true }
    }

    // Direct paid signup: the conversion payment installs this snapshot.
    await setPendingPriceSnapshot(client, sub.id, { snapshot, totalCents: snapshot.totalCents })
    return { sub: { ...sub, billing_interval: interval }, snapshot, trial: false }
  }, { db })

  if (outcome.error) return outcome

  try {
    if (outcome.trial) {
      if (outcome.sub.mollie_mandate_id) {
        return conflict('Payment is already scheduled', { code: 'already_scheduled' })
      }
      const { checkoutUrl } = await createMandateVerificationCheckout(db, outcome.sub, {
        email: user.email,
        name: user.name,
        amountCents: MANDATE_VERIFICATION_CENTS,
        redirect,
      })
      return {
        checkoutUrl,
        subscriptionId: outcome.sub.id,
        verificationCents: MANDATE_VERIFICATION_CENTS,
        totalCents: outcome.snapshot.totalCents,
        subscriptionStartsAt: outcome.sub.trial_ends_at,
      }
    }

    const { checkoutUrl } = await createConversionCheckout(db, outcome.sub, {
      email: user.email, name: user.name, amountCents: outcome.snapshot.totalCents,
      priceSnapshot: outcome.snapshot, redirect,
    })
    return { checkoutUrl, subscriptionId: outcome.sub.id, totalCents: outcome.snapshot.totalCents }
  } catch (err) {
    if (err instanceof ProviderError) return PROVIDER_ERROR
    throw err
  }
}

// Direct signup for a customer whose trial is already spent: create the
// subscription and its first module, then go straight to checkout.
export async function subscribe(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parseModuleSelection(body)
  if (parsed.error) return badRequest(parsed.error)

  const plan = await fetchPlan(db, parsed.planId)
  if (!plan || !plan.is_active) return { error: { status: 404, body: { error: 'Plan not found' } } }
  if (plan.is_fallback) return badRequest('The free plan needs no subscription')
  if (plan.audience !== parsed.audience) {
    return badRequest('That plan belongs to a different product', { code: 'audience_mismatch' })
  }

  const created = await withTransaction(async (client) => {
    const existing = await fetchLiveSubscriptionForUpdate(client, user.id)
    if (existing) abortTransaction(conflict('You already have a subscription', { code: 'already_subscribed' }))

    const targetLimits = mergeEntitlements(plan.entitlements, null).limits
    const blockers = await computeModuleBlockers(client, user.id, targetLimits, {
      audience: parsed.audience, lock: true,
    })
    if (blockers.length > 0) {
      abortTransaction(conflict('Current usage exceeds the target plan limits', {
        code: 'over_target_limit', blockers,
      }))
    }

    const sub = await insertSubscription(client, { user_id: user.id, status: 'pending_activation' })
    await insertModule(client, {
      subscription_id: sub.id, plan_id: plan.id, status: 'active',
      price_cents: 0, is_starter: true,
    })
    return { sub }
  }, {
    db,
    mapError: (err) => (err.code === '23505'
      ? conflict('You already have a subscription', { code: 'already_subscribed' })
      : null),
  })
  if (created.error) return created

  return checkout(db, user, body)
}
