import { request } from '../../api/_client.ts'
import { appendPeriodParams } from '../../finance/invoices/invoicePeriod.ts'
import type {
  Product, MerchSale, MerchSalesSummaryRow, Period, Id,
  ShopifyOrdersPage, ShopifyImportBody, ShopifyImportResult,
  ShopifyCustomPayoutBody, ShopifyManualPayoutsResult,
  ShopifyManualPayoutSettlementBody,
  PaypalCustomPayoutBody, PaypalCustomPayoutResult, PaypalPayoutCandidatesResult,
} from '../../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/merch${path}`, options)

// One URLSearchParams for the period plus an optional product_id, so we never
// hand-splice `?`/`&` into a query string.
function salesQuery(period: Period | null | undefined, productId?: Id): string {
  const params = new URLSearchParams()
  appendPeriodParams(params, period)
  if (productId != null) params.set('product_id', String(productId))
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const listProducts = () => api<Product[]>('/products')
export const createProduct = (body: Partial<Product>) =>
  api<Product>('/products', { method: 'POST', body: JSON.stringify(body) })
export const updateProduct = (id: Id, body: Partial<Product>) =>
  api<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const archiveProduct = (id: Id) => api<void>(`/products/${id}`, { method: 'DELETE' })

export const listMerchSales = (period?: Period | null, productId?: Id) =>
  api<MerchSale[]>(`/sales${salesQuery(period, productId)}`)
export const listMerchSalesSummary = (period: Period) =>
  api<MerchSalesSummaryRow[]>(`/sales/summary${salesQuery(period)}`)
export const listMerchSalePeriods = () => api<string[]>('/sales/periods')
export const recordMerchSale = (body: Partial<MerchSale>) =>
  api<MerchSale>('/sales', { method: 'POST', body: JSON.stringify(body) })
export const voidMerchSale = (id: Id) =>
  api<MerchSale>(`/sales/${id}/void`, { method: 'POST' })

// ---------- shopify import ----------

export const fetchShopifyOrders = (params: { cursor?: string; limit?: number } = {}) => {
  const q = new URLSearchParams()
  if (params.cursor) q.set('cursor', params.cursor)
  if (params.limit != null) q.set('limit', String(params.limit))
  const query = q.toString()
  const suffix = query ? `?${query}` : ''
  return api<ShopifyOrdersPage>(`/shopify/orders${suffix}`)
}

export const importShopifyOrders = (body: ShopifyImportBody) =>
  api<ShopifyImportResult>('/shopify/import', { method: 'POST', body: JSON.stringify(body) })

export const listManualShopifyPayouts = () =>
  api<ShopifyManualPayoutsResult>('/shopify/payouts?limit=100')

export const refreshManualShopifyPayouts = (fromDate: string, toDate: string) =>
  api<ShopifyManualPayoutsResult>('/shopify/payouts/refresh', {
    method: 'POST', body: JSON.stringify({ from_date: fromDate, to_date: toDate }),
  })

export const createCustomShopifyPayout = (body: ShopifyCustomPayoutBody) =>
  api<ShopifyManualPayoutsResult>('/shopify/payouts/custom', {
    method: 'POST', body: JSON.stringify(body),
  })

export const settleShopifyPayoutManually = (
  payoutId: Id, body: ShopifyManualPayoutSettlementBody,
) => api<{ payout: { id: Id; settlement_method: 'manual' } }>(
  `/shopify/payouts/${payoutId}/settle`,
  { method: 'POST', body: JSON.stringify(body) },
)

export const listPaypalPayoutCandidates = () =>
  api<PaypalPayoutCandidatesResult>('/paypal/payouts/candidates?limit=100')

export const createCustomPaypalPayout = (body: PaypalCustomPayoutBody) =>
  api<PaypalCustomPayoutResult>('/paypal/payouts/custom', {
    method: 'POST', body: JSON.stringify(body),
  })
