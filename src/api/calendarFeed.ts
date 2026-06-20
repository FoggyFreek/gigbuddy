import { request } from './_client.ts'

export interface CalendarFeed {
  url: string
  created_at: string
  last_accessed_at: string | null
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/calendar-feed${path}`, options)

export const getCalendarFeed = () => api<CalendarFeed | null>('/')
export const regenerateCalendarFeed = () => api<CalendarFeed>('/regenerate', { method: 'POST' })
export const deleteCalendarFeed = () => api<void>('/', { method: 'DELETE' })
