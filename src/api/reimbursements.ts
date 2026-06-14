import { request } from './_client.ts'
import type { MemberOutstanding, Purchase, Id } from '../types/entities.ts'

interface ReimbursementBody {
  band_member_id?: Id
  purchase_ids?: Id[]
  amount_cents?: number
  bank_account_code?: string
  paid_on?: string
}

interface ReimburseMemberBody {
  bank_account_code?: string
  paid_on?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/reimbursements${path}`, options)

export const listOutstanding = () => api<MemberOutstanding[]>('/outstanding')
export const listMemberPurchases = (memberId: Id) =>
  api<Purchase[]>(`/members/${memberId}/purchases`)

export const createReimbursement = (body: ReimbursementBody) =>
  api<void>('/', { method: 'POST', body: JSON.stringify(body) })

export const reimburseMemberFull = (memberId: Id, body: ReimburseMemberBody = {}) =>
  api<void>(`/members/${memberId}/full`, { method: 'POST', body: JSON.stringify(body) })
