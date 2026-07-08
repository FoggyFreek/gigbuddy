import { request } from './_client.ts'
import type { Subscription, SubscriptionPlan } from './billing.ts'

export interface AdminSubscription extends Subscription {
  userId: number
  userName: string
  userEmail: string
  createdAt: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/admin/subscriptions${path}`, options)

export const listSubscriptions = (repairOnly = false) =>
  api<{ subscriptions: AdminSubscription[] }>(repairOnly ? '/?repair=1' : '/')

export const grantComplimentary = (userId: number, planId: number, expiresAt?: string | null) =>
  api<Subscription>('/complimentary', {
    method: 'POST', body: JSON.stringify({ userId, planId, expiresAt: expiresAt ?? null }),
  })

export const revokeComplimentary = (userId: number) =>
  api<{ revoked: boolean }>(`/${userId}/revoke-complimentary`, { method: 'POST' })

// Plan catalog (super-admin) — CRUD against /api/admin/plans. The backend
// speaks the raw snake_case plan row (SubscriptionPlan).
export type AdminPlanInput = Pick<
  SubscriptionPlan,
  'slug' | 'name' | 'monthly_price_cents' | 'yearly_price_cents' | 'entitlements' | 'is_active' | 'sort_order'
>

export const listAdminPlans = () => request<SubscriptionPlan[]>('/api/admin/plans/')

export const createAdminPlan = (body: AdminPlanInput) =>
  request<SubscriptionPlan>('/api/admin/plans/', { method: 'POST', body: JSON.stringify(body) })

export const updateAdminPlan = (id: number, body: Partial<AdminPlanInput>) =>
  request<SubscriptionPlan>(`/api/admin/plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteAdminPlan = (id: number) =>
  request<null>(`/api/admin/plans/${id}`, { method: 'DELETE' })
