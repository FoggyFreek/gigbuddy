import { request } from './_client.js'
import { periodQueryString } from '../utils/invoicePeriod.js'

const api = (path, options) => request(`/api/reimbursements${path}`, options)

export const listOutstanding = () => api('/outstanding')
export const listMemberPurchases = (memberId) => api(`/members/${memberId}/purchases`)
export const listReimbursements = (period) => api(`/${periodQueryString(period)}`)
export const listReimbursementPeriods = () => api('/periods')

export const createReimbursement = (body) =>
  api('/', { method: 'POST', body: JSON.stringify(body) })

export const reimburseMemberFull = (memberId, body = {}) =>
  api(`/members/${memberId}/full`, { method: 'POST', body: JSON.stringify(body) })
