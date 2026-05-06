import { request } from './_client.js'

export const listInvites = () => request('/api/invites')
export const createInvite = (payload) =>
  request('/api/invites', { method: 'POST', body: JSON.stringify(payload) })
export const revokeInvite = (id) =>
  request(`/api/invites/${id}`, { method: 'DELETE' })
export const redeemInvite = (code) =>
  request('/api/invites/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
