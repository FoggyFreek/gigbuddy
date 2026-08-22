import { request } from '../../api/_client.ts'
import type { Id } from '../../types/entities.ts'
import type { LimitedCollectionResponse } from '../../types/api.ts'

export interface GigContract {
  id: Id
  gig_id: Id
  reference: string
  version: number
  locale: 'nl' | 'en'
  status: 'draft' | 'sent' | 'countersigned' | 'void'
  pdf_object_key: string | null
  countersigned_at: string | null
  countersigned_note: string | null
  created_at: string
}
export const listGigContracts = (gigId: Id, limit = 100) => request<LimitedCollectionResponse<GigContract>>(`/api/gigs/${gigId}/contracts?limit=${limit}`)
export const generateGigContract = (gigId: Id, lng: string) => request<GigContract>(`/api/gigs/${gigId}/contracts`, { method: 'POST', body: JSON.stringify({ lng }) })
export const getGigContract = (id: Id) => request<GigContract>(`/api/outreach/contracts/${id}`)
export const countersignGigContract = (id: Id, body: { date?: string; note?: string }) => request<GigContract>(`/api/outreach/contracts/${id}/countersign`, { method: 'POST', body: JSON.stringify(body) })
export const voidGigContract = (id: Id) => request<GigContract>(`/api/outreach/contracts/${id}/void`, { method: 'POST' })
export const contractPdfUrl = (id: Id) => `/api/outreach/contracts/${id}/pdf`
