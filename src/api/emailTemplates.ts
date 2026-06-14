import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

interface EmailTemplate {
  id?: Id
  name?: string
  subject?: string
  body_html?: string
  event_type?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/email-templates${path}`, options)

export const listEmailTemplates = () => api<EmailTemplate[]>('/')
export const getEmailTemplate = (id: Id) => api<EmailTemplate>(`/${id}`)
export const createEmailTemplate = (body: Partial<EmailTemplate>) =>
  api<EmailTemplate>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateEmailTemplate = (id: Id, body: Partial<EmailTemplate>) =>
  api<EmailTemplate>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteEmailTemplate = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
