import { request } from '../../api/_client.ts'
import type { PlanAudience } from '../../auth/planAudiences.ts'
import type { PriceSnapshot } from './pricing.ts'

export type BillingInterval = 'month' | 'year'

export interface SubscriptionPlanEntitlements {
  features: Record<string, boolean>
  limits: Record<string, number | null>
}

// Raw plan-catalog row (snake_case, as the admin CRUD returns it).
export interface SubscriptionPlan {
  id: number
  slug: string
  name: string
  /** Which product ladder this plan belongs to. Immutable after creation. */
  audience: PlanAudience
  monthly_price_cents: number | null
  yearly_price_cents: number | null
  entitlements: SubscriptionPlanEntitlements
  is_active: boolean
  is_fallback: boolean
  /** The plan a free trial grants on this ladder. One per audience. */
  is_trial_tier: boolean
  /** Ranks within an audience only — comparing across ladders is meaningless. */
  sort_order: number
}

export type ModuleStatus = 'pending' | 'active' | 'pending_removal'
export type ModuleChangeKind = 'upgrade' | 'downgrade' | 'remove' | 'trial_selection'

/** One product of a subscription. Absence of a module = that ladder's free plan. */
export interface SubscriptionModule {
  audience: PlanAudience
  planId: number
  planSlug: string
  /** `pending` grants nothing yet; `pending_removal` still grants until the boundary. */
  status: ModuleStatus
  priceCents: number
  isStarter: boolean
  pendingPlanId: number | null
  pendingPlanSlug: string | null
  pendingChangeKind: ModuleChangeKind | null
  pendingLimitsSnapshot: Record<string, number | null> | null
}

export interface Subscription {
  id: number
  status: string
  billingInterval: BillingInterval | null
  cancelAtPeriodEnd: boolean
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  convertedAt: string | null
  isComplimentary: boolean
  complimentaryExpiresAt: string | null
  /** What the CURRENT period was charged, line by line. */
  priceSnapshot: PriceSnapshot | null
  totalCents: number | null
  /** What the next renewal will charge — a lapsed promo shows up here first. */
  nextPriceSnapshot: PriceSnapshot | null
  nextTotalCents: number | null
  pendingTotalCents: number | null
  /**
   * While this is in the future, cancelling is immediate and refunds the charge
   * that opened the period in full. null once the window has closed.
   */
  refundEligibleUntil: string | null
  scheduleStale: boolean
  repairNeeded: boolean
  /** A reusable mandate exists; the trial-end charge can be automatic. */
  paymentMethodReady: boolean
  /** The customer completed checkout but the verification is still settling. */
  paymentVerificationPending: boolean
  /** Trial-end date once the provider schedule has been created. */
  subscriptionStartsAt: string | null
  modules: SubscriptionModule[]
}

/** One capacity conflict blocking a downgrade (tenantId null = the bands cap). */
export interface DowngradeBlocker {
  tenantId: number | null
  tenantName: string | null
  limit: string
  current: number
  target: number
}

export interface DowngradePreview {
  isDowngrade: boolean
  isRemoval: boolean
  /** Purgeable features whose stored data the change would delete. */
  features: string[]
  limitsSnapshot: Record<string, number | null>
  blockers: DowngradeBlocker[]
  /** What the subscription will cost once the change lands, or null on a trial. */
  nextSnapshot: PriceSnapshot | null
  effectiveAt: string | null
}

export interface ModuleChangePreview {
  snapshot: PriceSnapshot | null
  /** What is owed right now for the rest of the current period. 0 during a trial. */
  prorationCents: number
  isDowngrade: boolean
}

export interface BillingState {
  /** One subscription per user, made of modules. */
  subscription: Subscription | null
  trialAvailable: boolean
  trialDays: number
  /** Active (non-archived) bands this user owns — 0 means they only participate in others'. */
  ownedBandCount: number
  /** Whether the user has a personal workspace for an artist module to govern. */
  hasPersonalWorkspace: boolean
  /** Authoritative combined quotes for the trial's selected module set. */
  checkoutQuotes: Record<BillingInterval, PriceSnapshot | null>
  plans: SubscriptionPlan[]
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/billing${path}`, options)

export const getBillingState = () => api<BillingState>('/')

/** Where the hosted checkout returns the browser (server-side whitelist). */
export type CheckoutRedirect = 'billing' | 'onboarding'

/** Start the free trial: 30 days, Gold only, no payment method required. */
export const startTrial = (audience: PlanAudience) =>
  api<{ subscription: Subscription; trialDays: number }>('/trial', {
    method: 'POST', body: JSON.stringify({ audience }),
  })

/** Direct signup for a customer whose trial is already spent. */
export const subscribe = (
  audience: PlanAudience, planId: number, interval: BillingInterval, redirect?: CheckoutRedirect,
) =>
  api<{ checkoutUrl: string; subscriptionId: number; totalCents: number }>('/subscribe', {
    method: 'POST',
    body: JSON.stringify({ audience, planId, interval, ...(redirect ? { redirect } : {}) }),
  })

/** Verify payment details now and schedule the real trial conversion charge. */
export const checkout = (interval: BillingInterval, redirect?: CheckoutRedirect) =>
  api<{
    checkoutUrl: string
    subscriptionId: number
    verificationCents?: number
    totalCents: number
    subscriptionStartsAt?: string | null
  }>('/checkout', {
    method: 'POST', body: JSON.stringify({ interval, ...(redirect ? { redirect } : {}) }),
  })

/** What adding or upgrading a module would cost right now. */
export const previewModuleChange = (audience: PlanAudience, planId: number) =>
  api<ModuleChangePreview>('/modules/preview', {
    method: 'POST', body: JSON.stringify({ audience, planId }),
  })

/** Add a module, or move one up. Free during a trial; prorated on a paid cycle. */
export const changeModule = (audience: PlanAudience, planId: number) =>
  api<{ changed: boolean; pending?: boolean; trial?: boolean; immediate?: boolean; amountCents?: number }>('/modules', {
    method: 'POST', body: JSON.stringify({ audience, planId }),
  })

/** `planId` lowers the module; `remove: true` drops it altogether. */
export interface DowngradeTarget {
  audience: PlanAudience
  planId?: number
  remove?: boolean
}

export const downgradePreview = (target: DowngradeTarget) =>
  api<DowngradePreview>('/downgrade/preview', { method: 'POST', body: JSON.stringify(target) })

export const downgrade = (target: DowngradeTarget, confirmation: string) =>
  api<{ scheduled?: boolean; immediate?: boolean; targetPlanSlug: string | null }>('/downgrade', {
    method: 'POST', body: JSON.stringify({ ...target, confirmation }),
  })

/**
 * `immediate` is the withdrawal path: inside `refundEligibleUntil` it ends access
 * now and refunds the charge that opened the period. The server refuses it
 * outside the window rather than silently falling back to a period-end cancel.
 */
export const cancelSubscription = (immediate = false) =>
  api<{
    canceled?: boolean; atPeriodEnd?: boolean; alreadyScheduled?: boolean
    refunded?: boolean; refundAmountCents?: number
  }>('/cancel', { method: 'POST', body: JSON.stringify({ immediate }) })

export const resumeSubscription = () =>
  api<{ resumed: boolean }>('/resume', { method: 'POST', body: JSON.stringify({}) })

export const syncSubscription = () =>
  api<{ subscription: Subscription | null }>('/sync', { method: 'POST', body: JSON.stringify({}) })

// The interval price a plan charges, or null when that interval is unavailable
// (plan_not_priced). Re-exported from the shared pricing engine so the preview
// and the charge read the same column.
export { priceForInterval } from './pricing.ts'
