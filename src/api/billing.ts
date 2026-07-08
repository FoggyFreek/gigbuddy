import { request } from './_client.ts'

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
  monthly_price_cents: number | null
  yearly_price_cents: number | null
  entitlements: SubscriptionPlanEntitlements
  is_active: boolean
  is_fallback: boolean
  sort_order: number
}

export interface PendingChange {
  planId: number
  kind: 'upgrade' | 'downgrade' | 'interval'
  interval: BillingInterval
  priceCents: number
}

export interface Subscription {
  id: number
  planId: number
  planSlug: string
  status: string
  billingInterval: BillingInterval | null
  priceCents: number
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  isComplimentary: boolean
  complimentaryExpiresAt: string | null
  pendingChange: PendingChange | null
  /** A confirmed downgrade whose limits snapshot already binds capacity growth. */
  downgradeScheduled: boolean
  pendingLimitsSnapshot: Record<string, number | null> | null
  scheduleStale: boolean
  repairNeeded: boolean
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
  isFreeFallback: boolean
  /** Purgeable features whose stored data the downgrade would delete. */
  features: string[]
  limitsSnapshot: Record<string, number | null>
  blockers: DowngradeBlocker[]
}

export interface BillingState {
  subscription: Subscription | null
  /** Active (non-archived) tenants this user owns — 0 means they only participate in others' bands. */
  ownedTenantCount: number
  plans: SubscriptionPlan[]
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/billing${path}`, options)

export const getBillingState = () => api<BillingState>('/')

/** Where the hosted checkout returns the browser (server-side whitelist). */
export type CheckoutRedirect = 'billing' | 'onboarding'

export const subscribe = (planId: number, interval: BillingInterval, redirect?: CheckoutRedirect) =>
  api<{ checkoutUrl: string; trial: boolean }>('/subscribe', {
    method: 'POST', body: JSON.stringify({ planId, interval, ...(redirect ? { redirect } : {}) }),
  })

export const changePlan = (planId: number, interval: BillingInterval) =>
  api<{ changed: boolean; pending?: boolean; trial?: boolean }>('/change-plan', {
    method: 'POST', body: JSON.stringify({ planId, interval }),
  })

export const downgrade = (planId: number, interval: BillingInterval, confirmation: string) =>
  api<{ scheduled?: boolean; immediate?: boolean }>('/downgrade', {
    method: 'POST', body: JSON.stringify({ planId, interval, confirmation }),
  })

export const downgradePreview = (planId: number, interval: BillingInterval) =>
  api<DowngradePreview>('/downgrade/preview', {
    method: 'POST', body: JSON.stringify({ planId, interval }),
  })

export const cancelSubscription = () =>
  api<{ canceled?: boolean; atPeriodEnd?: boolean; alreadyScheduled?: boolean }>('/cancel', { method: 'POST' })

export const resumeSubscription = () =>
  api<{ resumed: boolean }>('/resume', { method: 'POST' })

export const syncSubscription = () =>
  api<{ subscription: Subscription | null }>('/sync', { method: 'POST' })

// The interval price a plan charges, or null when that interval is unavailable
// (plan_not_priced). Mirrors server billingShared.priceForInterval.
export function priceForInterval(plan: SubscriptionPlan, interval: BillingInterval): number | null {
  return interval === 'year' ? plan.yearly_price_cents : plan.monthly_price_cents
}
