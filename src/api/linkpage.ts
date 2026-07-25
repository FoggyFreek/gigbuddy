import { request } from './_client.ts'

export interface LinkpageStatus {
  configured: boolean
  publicUrl: string | null
}

export interface LinkpageHandoff {
  url: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/linkpage${path}`, options)

export const getLinkpageStatus = () => api<LinkpageStatus>('/status')
export const createLinkpageHandoff = () => api<LinkpageHandoff>('/handoff', { method: 'POST' })
