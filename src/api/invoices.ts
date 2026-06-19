import { request, requestBlob, requestForm } from './_client.ts'
import type { Invoice, Id, Period } from '../types/entities.ts'
import { periodQueryString } from '../utils/invoicePeriod.ts'

interface InvoicePeriod {
  label?: string
  year?: number
  month?: number
  quarter?: number
  mode?: string
}

interface EmlDefaults {
  to?: string
  subject?: string
  body?: string
  personalMessage?: string
}

interface PaymentLinkResult {
  payment_link_id?: string
  payment_link_url?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/invoices${path}`, options)

export const listInvoices = (period: Period) => api<Invoice[]>(`/${periodQueryString(period)}`)
export const listInvoicePeriods = () => api<InvoicePeriod[]>('/periods')
export const searchInvoices = (q: string) =>
  api<Invoice[]>(`/search?${new URLSearchParams({ q })}`)
export const getInvoice = (id: Id) => api<Invoice>(`/${id}`)
export const draftFromGig = (gigId: Id) => api<Invoice>(`/draft-from-gig/${gigId}`)
export const createInvoice = (body: Partial<Invoice>) =>
  api<Invoice>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateInvoice = (id: Id, body: Partial<Invoice>) =>
  api<Invoice>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteInvoice = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
export const renderInvoice = (id: Id) => api<Invoice>(`/${id}/render`, { method: 'POST' })

export function uploadInvoiceLogo(id: Id, file: File) {
  const fd = new FormData()
  fd.append('logo', file)
  return requestForm<Invoice>(`/api/invoices/${id}/logo`, fd)
}

export const removeInvoiceLogo = (id: Id) => api<Invoice>(`/${id}/logo`, { method: 'DELETE' })

export const createInvoicePaymentLink = (id: Id, body: Record<string, unknown> = {}) =>
  api<PaymentLinkResult>(`/${id}/payment-link`, { method: 'POST', body: JSON.stringify(body) })

export const syncInvoicePaymentLink = (id: Id) =>
  api<Invoice>(`/${id}/payment-link/sync`, { method: 'POST' })

export const deleteInvoicePaymentLink = (id: Id) =>
  api<void>(`/${id}/payment-link`, { method: 'DELETE' })

export const getInvoiceEmlDefaults = (id: Id) => api<EmlDefaults>(`/${id}/eml-defaults`)

export const downloadInvoiceEml = (id: Id, personalMessage?: string) =>
  requestBlob(`/api/invoices/${id}/eml`, {
    method: 'POST',
    body: JSON.stringify({ personalMessage }),
  })
