import { request, requestBlob, requestBlobWithHeaders, requestForm } from '../../api/_client.ts'
import type { Gig, Invoice, Id, Period } from '../../types/entities.ts'
import { periodQueryString } from './invoicePeriod.ts'
import type { OutreachCampaign } from '../../promotion/outreach/outreachCampaigns.ts'

interface InvoicePeriod {
  label?: string
  year?: number
  month?: number
  quarter?: number
  mode?: string
}

export type InvoiceAttachmentMode = 'pdf' | 'pdf_xml' | 'pdf_xml_embedded'

export interface InvoiceEmailTemplateOption {
  id: Id
  name: string
  locale: 'nl' | 'en'
}

export interface InvoiceEmailDefaults {
  templates: InvoiceEmailTemplateOption[]
  message: string
  to: string | null
  status: Invoice['status']
}

export interface InvoiceEmailPreview {
  subject: string
  html: string
}

export interface InvoiceEmailRequest {
  templateId?: Id
  message?: string
  attachments?: InvoiceAttachmentMode
}

interface PaymentLinkSyncResult {
  paymentLinkId?: string | null
  paymentLinkUrl?: string | null
  paymentId?: string | null
  status?: string | null
  paidAt?: string | null
  invoiceStatus?: Invoice['status']
}

export interface InvoiceGigSearchResult extends Gig {
  has_invoice: boolean
}

/** One billable organisation option returned by the draft-from-gig endpoint. */
export interface InvoiceBillingTarget {
  type: string
  name?: string
  address_city?: string
  contact_title?: string | null
  contact_given_name?: string | null
  contact_family_name?: string | null
  address_street?: string | null
  address_postal_code?: string | null
  address_country?: string | null
  email?: string | null
  kvk_number?: string | null
  tax_id?: string | null
}

/** Response of GET /invoices/draft-from-gig/:gigId — a prefill, not a persisted invoice. */
export interface InvoiceGigDraft {
  draft?: Record<string, unknown>
  billing_targets?: InvoiceBillingTarget[]
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/invoices${path}`, options)

export const listInvoices = (period: Period) => api<Invoice[]>(`/${periodQueryString(period)}`)
export const listInvoicePeriods = () => api<InvoicePeriod[]>('/periods')
export const searchInvoices = (q: string) =>
  api<Invoice[]>(`/search?${new URLSearchParams({ q })}`)
export const searchInvoiceGigs = (q: string) =>
  api<InvoiceGigSearchResult[]>(`/gig-search?${new URLSearchParams({ q })}`)
export const getInvoice = (id: Id) => api<Invoice>(`/${id}`)
export const draftFromGig = (gigId: Id) => api<InvoiceGigDraft>(`/draft-from-gig/${gigId}`)
export const listInvoicesByGig = (gigId: Id, opts?: RequestInit) =>
  api<Invoice[]>(`/by-gig/${gigId}`, opts)
export const createInvoice = (body: Partial<Invoice>) =>
  api<Invoice>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateInvoice = (id: Id, body: Partial<Invoice>) =>
  api<Invoice>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteInvoice = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
/** Re-renders and stores the PDF. Responds with the new key only, not the invoice. */
export const renderInvoice = (id: Id) =>
  api<{ pdf_path: string | null }>(`/${id}/render`, { method: 'POST' })

export function uploadInvoiceLogo(id: Id, file: File) {
  const fd = new FormData()
  fd.append('logo', file)
  return requestForm<Invoice>(`/api/invoices/${id}/logo`, fd)
}

export const removeInvoiceLogo = (id: Id) => api<Invoice>(`/${id}/logo`, { method: 'DELETE' })

export const createInvoicePaymentLink = (id: Id, body: Record<string, unknown> = {}) =>
  api<Invoice>(`/${id}/payment-link`, { method: 'POST', body: JSON.stringify(body) })

export const syncInvoicePaymentLink = (id: Id) =>
  api<PaymentLinkSyncResult>(`/${id}/payment-link/sync`, { method: 'POST' })

export const deleteInvoicePaymentLink = (id: Id) =>
  api<Invoice>(`/${id}/payment-link`, { method: 'DELETE' })

export const getInvoiceEmailDefaults = (id: Id) => api<InvoiceEmailDefaults>(`/${id}/email/defaults`)

export const previewInvoiceEmail = (id: Id, body: InvoiceEmailRequest) =>
  api<InvoiceEmailPreview>(`/${id}/email/preview`, { method: 'POST', body: JSON.stringify(body) })

// Two calls on purpose: creating the campaign first gives the send a stable id,
// so a retried send cannot deliver the invoice twice.
export const createInvoiceEmailCampaign = (id: Id, body: InvoiceEmailRequest) =>
  api<OutreachCampaign>(`/${id}/email/campaign`, { method: 'POST', body: JSON.stringify(body) })

export const sendInvoiceEmailCampaign = (id: Id, campaignId: Id) =>
  api<OutreachCampaign>(`/${id}/email/send`, { method: 'POST', body: JSON.stringify({ campaignId }) })

// UBL 2.1 / Peppol BIS Billing 3.0 XML. A blob rather than a plain link so a
// failure surfaces as an in-app error instead of raw JSON in a new tab.
export const downloadInvoiceUbl = (id: Id) =>
  requestBlob(`/api/invoices/${id}/ubl`, { method: 'GET' })

export const downloadInvoiceUblWithPdf = (id: Id) =>
  requestBlob(`/api/invoices/${id}/ubl?embedPdf=true`, { method: 'GET' })

// With headers: the server names the file (locale-dependent), so the client
// should not re-derive it.
export const downloadInvoiceEml = (id: Id, body: InvoiceEmailRequest) =>
  requestBlobWithHeaders(`/api/invoices/${id}/eml`, { method: 'POST', body: JSON.stringify(body) })
