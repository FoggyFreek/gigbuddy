import { request } from './_client.js'

const api = (path, options) => request(`/api/setlists${path}`, options)

export const listSetlists  = ()         => api('/')
export const getSetlist    = (id)       => api(`/${id}`)
export const createSetlist = (body)     => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateSetlist = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSetlist = (id)       => api(`/${id}`, { method: 'DELETE' })

export const addSet     = (id, body)        => api(`/${id}/sets`, { method: 'POST', body: JSON.stringify(body) })
export const updateSet  = (id, setId, body) => api(`/${id}/sets/${setId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSet  = (id, setId)       => api(`/${id}/sets/${setId}`, { method: 'DELETE' })
export const reorderSets = (id, orderedSetIds) =>
  api(`/${id}/sets/reorder`, { method: 'PATCH', body: JSON.stringify({ orderedSetIds }) })

export const addItem    = (id, setId, body)  => api(`/${id}/sets/${setId}/items`, { method: 'POST', body: JSON.stringify(body) })
export const updateItem = (id, itemId, body) => api(`/${id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteItem = (id, itemId)       => api(`/${id}/items/${itemId}`, { method: 'DELETE' })
export const reorderItems = (id, sets) =>
  api(`/${id}/items/reorder`, { method: 'PATCH', body: JSON.stringify({ sets }) })
