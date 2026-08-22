import { request } from '../../api/_client.ts'
import type { Id } from '../../types/entities.ts'
import type { LimitedCollectionResponse } from '../../types/api.ts'

export type TemplateContext = 'venue' | 'invoice'

export interface OutreachTemplate {
  id: Id
  name: string
  context: TemplateContext
  subject: string
  preview_text: string | null
  body_json: Record<string, unknown>
  body_html: string
  body_text: string
  origin_key: string | null
  locale: 'nl' | 'en'
  created_at: string
  updated_at: string
}
export interface OutreachField {
  key: string
  token: string
  label: string
  scope: string
  block: boolean
  sample: string
}
export type OutreachImageKey =
  | 'banner' | 'logo-light' | 'logo-dark' | 'avatar'
  | 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'spotify' | 'bandsintown'
export interface OutreachImageOption {
  key: OutreachImageKey
  category: 'branding' | 'social'
  available: boolean
  src: string
  whiteSrc?: string
  href?: string
  defaultWidth: string
  defaultHeight: string
}
export type CreateOutreachTemplate = Omit<OutreachTemplate, 'id' | 'created_at' | 'updated_at'>

const api = <T>(path: string, options?: RequestInit) => request<T>(`/api/outreach${path}`, options)

export const listOutreachTemplates = (limit = 100, context?: TemplateContext) =>
  api<LimitedCollectionResponse<OutreachTemplate>>(
    `/templates?limit=${limit}${context ? `&context=${context}` : ''}`,
  )
export const getOutreachTemplate = (id: Id) => api<OutreachTemplate>(`/templates/${id}`)
export const createOutreachTemplate = (body: Partial<CreateOutreachTemplate>) =>
  api<OutreachTemplate>('/templates', { method: 'POST', body: JSON.stringify(body) })
export const updateOutreachTemplate = (id: Id, body: Partial<OutreachTemplate>) =>
  api<OutreachTemplate>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const copyOutreachTemplate = (id: Id) =>
  api<OutreachTemplate>(`/templates/${id}/copy`, { method: 'POST' })
export const deleteOutreachTemplate = (id: Id) => api<void>(`/templates/${id}`, { method: 'DELETE' })
export const listOutreachFields = (locale: 'nl' | 'en', context: TemplateContext = 'venue') =>
  api<OutreachField[]>(`/fields?locale=${locale}&context=${context}`)
export const listOutreachImages = () => api<OutreachImageOption[]>('/images')
