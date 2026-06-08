import { request } from './_client.js'

const api = (path, options) => request(`/api/purchases${path}`, options)

export const listPurchases  = ()         => api('/')
export const getPurchase    = (id)       => api(`/${id}`)
export const createPurchase = (body)     => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updatePurchase = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deletePurchase = (id)       => api(`/${id}`, { method: 'DELETE' })

export const registerPurchasePayment = (id, body = {}) =>
  api(`/${id}/payment`, { method: 'POST', body: JSON.stringify(body) })
