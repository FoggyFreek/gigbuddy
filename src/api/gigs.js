import { request, requestForm } from './_client.js'

const api = (path, options) => request(`/api/gigs${path}`, options)

export const listGigs = () => api('/')
export const getGig = (id, opts) => api(`/${id}`, opts)
export const createGig = (body) => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateGig = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteGig = (id) => api(`/${id}`, { method: 'DELETE' })

export const createTask = (gigId, body) =>
  api(`/${gigId}/tasks`, { method: 'POST', body: JSON.stringify(body) })
export const updateTask = (gigId, taskId, body) =>
  api(`/${gigId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteTask = (gigId, taskId) =>
  api(`/${gigId}/tasks/${taskId}`, { method: 'DELETE' })

export const uploadGigBanner = (gigId, file) => {
  const fd = new FormData()
  fd.append('banner', file, 'banner.png')
  return requestForm(`/api/gigs/${gigId}/banner`, fd)
}
export const deleteGigBanner = (gigId) =>
  request(`/api/gigs/${gigId}/banner`, { method: 'DELETE' })

export const uploadGigAttachment = (gigId, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm(`/api/gigs/${gigId}/attachments`, fd)
}
export const deleteGigAttachment = (gigId, attachmentId) =>
  request(`/api/gigs/${gigId}/attachments/${attachmentId}`, { method: 'DELETE' })

export const addGigParticipant = (gigId, bandMemberId) =>
  api(`/${gigId}/participants`, { method: 'POST', body: JSON.stringify({ band_member_id: bandMemberId }) })
export const removeGigParticipant = (gigId, bandMemberId) =>
  api(`/${gigId}/participants/${bandMemberId}`, { method: 'DELETE' })
export const setGigVote = (gigId, bandMemberId, vote) =>
  api(`/${gigId}/participants/${bandMemberId}`, { method: 'PATCH', body: JSON.stringify({ vote }) })
