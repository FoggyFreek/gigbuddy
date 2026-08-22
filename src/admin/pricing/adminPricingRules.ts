import { request } from '../../api/_client.ts'
import type { PricingRule } from '../../commerce/billing/pricing.ts'

// Pricing rules are edited by SUPERSEDING them, never by patching what they
// charge: a stored price snapshot pins { code, version }, so the row that
// priced an existing agreement has to stay on disk exactly as it was. PATCH
// therefore only carries the cosmetic name and retirement.
export type AdminPricingRuleInput = Pick<
  PricingRule,
  'code' | 'name' | 'discount_type' | 'combinable' | 'effective_from' | 'effective_to'
  | 'required_audiences' | 'min_module_count' | 'billing_intervals' | 'priority'
> & {
  /** Percent for a percentage rule; the server accepts a number here. */
  percent?: number | null
  amount_cents?: number | null
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/admin/pricing-rules${path}`, options)

export const listPricingRules = () => api<PricingRule[]>('/')

export const createPricingRule = (body: AdminPricingRuleInput) =>
  api<PricingRule>('/', { method: 'POST', body: JSON.stringify(body) })

/** Retires rule `id` and installs these terms as the next version of its code. */
export const createPricingRuleVersion = (id: number, body: Omit<AdminPricingRuleInput, 'code'>) =>
  api<PricingRule>(`/${id}/versions`, { method: 'POST', body: JSON.stringify(body) })

export const renamePricingRule = (id: number, name: string) =>
  api<PricingRule>(`/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })

export const retirePricingRule = (id: number) =>
  api<PricingRule>(`/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) })
