import { request } from './_client.js'

const api = (path, options) => request(`/api/merch${path}`, options)

export const listProducts   = ()         => api('/products')
export const createProduct  = (body)     => api('/products', { method: 'POST', body: JSON.stringify(body) })
export const updateProduct  = (id, body) => api(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const archiveProduct = (id)       => api(`/products/${id}`, { method: 'DELETE' })

export const listMerchSales  = ()     => api('/sales')
export const recordMerchSale = (body) => api('/sales', { method: 'POST', body: JSON.stringify(body) })
export const voidMerchSale   = (id)   => api(`/sales/${id}/void`, { method: 'POST' })
