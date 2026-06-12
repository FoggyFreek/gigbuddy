import { request, requestForm } from './_client.js'

const api = (path, options) => request(`/api/songs${path}`, options)

export const listSongs   = ()         => api('/')
export const getSong     = (id)       => api(`/${id}`)
export const createSong  = (body)     => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateSong  = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSong  = (id)       => api(`/${id}`, { method: 'DELETE' })
export const importSongs = (rows)     => api('/import', { method: 'POST', body: JSON.stringify(rows) })

export const searchSongs = (q) => api(`/search?${new URLSearchParams({ q: q ?? '' })}`)

export const searchSongTags = (q) => api(`/tags?${new URLSearchParams({ q: q ?? '' })}`)
export const setSongTags    = (id, tags) =>
  api(`/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) })

export const addSongLink    = (id, body)         => api(`/${id}/links`, { method: 'POST', body: JSON.stringify(body) })
export const updateSongLink = (id, linkId, body) => api(`/${id}/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSongLink = (id, linkId)       => api(`/${id}/links/${linkId}`, { method: 'DELETE' })

export const uploadSongDocument = (id, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm(`/api/songs/${id}/documents`, fd)
}
export const deleteSongDocument = (id, docId) => api(`/${id}/documents/${docId}`, { method: 'DELETE' })

export const uploadSongRecording = (id, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm(`/api/songs/${id}/recordings`, fd)
}
export const deleteSongRecording = (id, recId) => api(`/${id}/recordings/${recId}`, { method: 'DELETE' })
