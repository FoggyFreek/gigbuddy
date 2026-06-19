import { request, requestForm } from './_client.ts'
import type { Purchase, PurchaseAttachment, Period, Id } from '../types/entities.ts'
import { periodQueryString } from '../utils/invoicePeriod.ts'

interface PaymentBody {
  paid_at?: string
  payment_method?: string
  paid_by_band_member_id?: Id
  bank_account_code?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/purchases${path}`, options)

export const listPurchases = (period: Period) =>
  api<Purchase[]>(`/${periodQueryString(period)}`)
export const listPurchasePeriods = () => api<string[]>('/periods')
export const searchPurchases = (q: string) =>
  api<Purchase[]>(`/search?${new URLSearchParams({ q })}`)
export const getPurchase = (id: Id) => api<Purchase>(`/${id}`)
export const createPurchase = (body: Partial<Purchase>) =>
  api<Purchase>('/', { method: 'POST', body: JSON.stringify(body) })
export const updatePurchase = (id: Id, body: Partial<Purchase>) =>
  api<Purchase>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deletePurchase = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })

export const registerPurchasePayment = (id: Id, body: PaymentBody = {}) =>
  api<Purchase>(`/${id}/payment`, { method: 'POST', body: JSON.stringify(body) })

export const uploadPurchaseAttachment = (id: Id, file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm<PurchaseAttachment>(`/api/purchases/${id}/attachments`, fd)
}
export const deletePurchaseAttachment = (id: Id, attachmentId: Id) =>
  api<void>(`/${id}/attachments/${attachmentId}`, { method: 'DELETE' })
