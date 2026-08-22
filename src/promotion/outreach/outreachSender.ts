import { request } from '../../api/_client.ts'

export interface OutreachSender {
  configured: boolean
  fromName: string | null
  fromEmail: string | null
  replyTo: string | null
}
export const getOutreachSender = () => request<OutreachSender>('/api/outreach/sender')
export const saveOutreachSender = (body: { fromName: string; fromEmail: string; replyTo: string | null }) =>
  request<OutreachSender>('/api/outreach/sender', { method: 'PUT', body: JSON.stringify(body) })
