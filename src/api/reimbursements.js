import { request } from './_client.js'

const api = (path, options) => request(`/api/reimbursements${path}`, options)

export const listOutstanding = () => api('/outstanding')
export const listMemberPurchases = (memberId) => api(`/members/${memberId}/purchases`)

export const createReimbursement = (body) =>
  api('/', { method: 'POST', body: JSON.stringify(body) })

export const reimburseMemberFull = (memberId, body = {}) =>
  api(`/members/${memberId}/full`, { method: 'POST', body: JSON.stringify(body) })
