import { request } from './_client.js'

const api = (path, options) => request(`/api/journal${path}`, options)

export const listJournals   = ()         => api('/')
export const getJournal     = (id)       => api(`/${id}`)
export const createJournal  = (body)     => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateJournal  = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteJournal  = (id)       => api(`/${id}`, { method: 'DELETE' })

export const approveJournal  = (id)  => api(`/${id}/approve`, { method: 'POST' })
export const approveJournals = (ids) => api('/approve', { method: 'POST', body: JSON.stringify({ ids }) })
