import { request } from './_client.js'

const api = (path, options) => request(`/api/venues${path}`, options)

export const listVenues   = ()         => api('/')
export const getVenue     = (id)       => api(`/${id}`)
export const createVenue  = (body)     => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateVenue  = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteVenue  = (id)       => api(`/${id}`, { method: 'DELETE' })
export const importVenues = (rows)     => api('/import', { method: 'POST', body: JSON.stringify(rows) })
