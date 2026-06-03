import { request } from './_client.js'

const api = (path, options) => request(`/api/contacts${path}`, options)

export const listContacts   = ()         => api('/')
export const searchContacts = (q)        => api(`/search?${new URLSearchParams({ q })}`)
export const getContact     = (id)       => api(`/${id}`)
export const createContact  = (body)     => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateContact  = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteContact  = (id)       => api(`/${id}`, { method: 'DELETE' })
export const importContacts  = (rows)     => api('/import', { method: 'POST', body: JSON.stringify(rows) })
export const addContactNote  = (id, note) => api(`/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) })
export const deleteContactNote = (id, noteId) => api(`/${id}/notes/${noteId}`, { method: 'DELETE' })

export const listContactVenues  = (id)         => api(`/${id}/venues`)
export const addContactVenue    = (id, venueId) =>
  api(`/${id}/venues`, { method: 'POST', body: JSON.stringify({ venue_id: venueId }) })
export const removeContactVenue = (id, venueId) =>
  api(`/${id}/venues/${venueId}`, { method: 'DELETE' })
