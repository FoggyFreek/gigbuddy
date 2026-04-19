import { request } from './_client.js'

const api = (path, options) => request(`/api/rehearsals${path}`, options)

export const listRehearsals = () => api('/')
export const getRehearsal = (id) => api(`/${id}`)
export const createRehearsal = (body) =>
  api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateRehearsal = (id, body) =>
  api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteRehearsal = (id) =>
  api(`/${id}`, { method: 'DELETE' })

export const addParticipant = (id, bandMemberId) =>
  api(`/${id}/participants`, {
    method: 'POST',
    body: JSON.stringify({ band_member_id: bandMemberId }),
  })
export const removeParticipant = (id, bandMemberId) =>
  api(`/${id}/participants/${bandMemberId}`, { method: 'DELETE' })
export const setVote = (id, bandMemberId, vote) =>
  api(`/${id}/participants/${bandMemberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ vote }),
  })
