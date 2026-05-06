import { request } from './_client.js'

const api = (path, options) => request(`/api/users${path}`, options)

export const listMemberships = () => api('/')
export const updateMembership = (userId, patch) =>
  api(`/${userId}/membership`, { method: 'PATCH', body: JSON.stringify(patch) })
export const updateMembershipBandMember = (userId, band_member_id) =>
  api(`/${userId}/band-member`, {
    method: 'PATCH',
    body: JSON.stringify({ band_member_id }),
  })
export const removeMembership = (userId) =>
  api(`/${userId}`, { method: 'DELETE' })
