import { request } from './_client.js'

const api = (path, options) => request(`/api/band-events${path}`, options)

export const listBandEvents = () => api('/')
export const getBandEvent = (id) => api(`/${id}`)
export const createBandEvent = (body) =>
  api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateBandEvent = (id, body) =>
  api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteBandEvent = (id) =>
  api(`/${id}`, { method: 'DELETE' })
