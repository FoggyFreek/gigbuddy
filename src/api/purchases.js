import { request, requestForm } from './_client.js'
import { periodQueryString } from '../utils/invoicePeriod.js'

const api = (path, options) => request(`/api/purchases${path}`, options)

export const listPurchases  = (period)   => api(`/${periodQueryString(period)}`)
export const listPurchasePeriods = ()    => api('/periods')
export const getPurchase    = (id)       => api(`/${id}`)
export const createPurchase = (body)     => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updatePurchase = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deletePurchase = (id)       => api(`/${id}`, { method: 'DELETE' })

export const registerPurchasePayment = (id, body = {}) =>
  api(`/${id}/payment`, { method: 'POST', body: JSON.stringify(body) })

export const uploadPurchaseAttachment = (id, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm(`/api/purchases/${id}/attachments`, fd)
}
export const deletePurchaseAttachment = (id, attachmentId) =>
  api(`/${id}/attachments/${attachmentId}`, { method: 'DELETE' })
