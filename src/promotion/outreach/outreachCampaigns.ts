import { request } from '../../api/_client.ts'
import type { Id } from '../../types/entities.ts'
import type { LimitedCollectionResponse } from '../../types/api.ts'

export interface CampaignRecipientInput {
  contactId?: Id
  venueId?: Id
  addressSource?: 'primary_contact' | 'venue'
}
export interface OutreachRecipient { id: Id; to_name: string | null; to_email: string; merged_subject: string; status: string; error_message: string | null }
export interface OutreachCampaign { id: Id; status: string; template_id: Id | null; contract_id: Id | null; created_at: string; sent_at: string | null; subject_snapshot?: string; recipients?: OutreachRecipient[] }
export interface OutreachSuppression { id: Id; email: string; reason: string; created_at: string }
export const listOutreachCampaigns = (limit = 100) => request<LimitedCollectionResponse<OutreachCampaign>>(`/api/outreach/campaigns?limit=${limit}`)
export const createOutreachCampaign = (body: { templateId: Id; recipients: CampaignRecipientInput[]; contractId?: Id }) => request<OutreachCampaign>('/api/outreach/campaigns', { method: 'POST', body: JSON.stringify(body) })
export const getOutreachCampaign = (id: Id) => request<OutreachCampaign>(`/api/outreach/campaigns/${id}`)
export const sendOutreachCampaign = (id: Id) => request<OutreachCampaign>(`/api/outreach/campaigns/${id}/send`, { method: 'POST' })
export const listOutreachSuppressions = (limit = 100) => request<LimitedCollectionResponse<OutreachSuppression>>(`/api/outreach/campaigns/suppressions/list?limit=${limit}`)
export const addOutreachSuppression = (email: string) => request<OutreachSuppression>('/api/outreach/campaigns/suppressions/list', { method: 'POST', body: JSON.stringify({ email, reason: 'manual' }) })
export const removeOutreachSuppression = (id: Id) => request<void>(`/api/outreach/campaigns/suppressions/list/${id}`, { method: 'DELETE' })
