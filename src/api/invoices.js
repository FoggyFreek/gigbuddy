import { request, requestBlob, requestForm } from './_client.js'
import { periodQueryString } from '../utils/invoicePeriod.js'

const api = (path, options) => request(`/api/invoices${path}`, options)

export const listInvoices   = (period)   => api(`/${periodQueryString(period)}`)
export const listInvoicePeriods = ()     => api('/periods')
export const getInvoice     = (id)       => api(`/${id}`)
export const draftFromGig   = (gigId)    => api(`/draft-from-gig/${gigId}`)
export const createInvoice  = (body)     => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateInvoice  = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteInvoice  = (id)       => api(`/${id}`, { method: 'DELETE' })
export const renderInvoice  = (id)       => api(`/${id}/render`, { method: 'POST' })

export function uploadInvoiceLogo(id, file) {
  const fd = new FormData()
  fd.append('logo', file)
  return requestForm(`/api/invoices/${id}/logo`, fd)
}

export const removeInvoiceLogo = (id) => api(`/${id}/logo`, { method: 'DELETE' })

export const createInvoicePaymentLink = (id, body = {}) =>
  api(`/${id}/payment-link`, { method: 'POST', body: JSON.stringify(body) })

export const syncInvoicePaymentLink = (id) =>
  api(`/${id}/payment-link/sync`, { method: 'POST' })

export const deleteInvoicePaymentLink = (id) =>
  api(`/${id}/payment-link`, { method: 'DELETE' })

export const getInvoiceEmlDefaults = (id) => api(`/${id}/eml-defaults`)

export const downloadInvoiceEml = (id, personalMessage) =>
  requestBlob(`/api/invoices/${id}/eml`, {
    method: 'POST',
    body: JSON.stringify({ personalMessage }),
  })
