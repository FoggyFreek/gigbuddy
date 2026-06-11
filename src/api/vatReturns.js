import { request } from './_client.js'

const api = (path, options) => request(`/api/vat-returns${path}`, options)

export const listVatReturns = () => api('')
export const previewVatReturn = (year, quarter) => api(`/preview?year=${year}&quarter=${quarter}`)
export const createVatReturn = (body) => api('', { method: 'POST', body: JSON.stringify(body) })
export const getVatReturn = (id) => api(`/${id}`)
export const recordVatPayment = (id, body) =>
  api(`/${id}/payments`, { method: 'POST', body: JSON.stringify(body) })
