import { request } from './_client.ts'
import type { AppNotification, NotificationPrefs } from '../types/entities.ts'

export interface NotificationList {
  notifications: AppNotification[]
  unreadCount: number
}

export interface NotificationPrefsUpdate {
  types?: { type: string; enabled: boolean }[]
  tenants?: { tenantId: number; enabled: boolean }[]
}

export const listNotifications = () => request<NotificationList>('/api/notifications')

export const markRead = (id: number) =>
  request<void>(`/api/notifications/${id}/read`, { method: 'POST' })

export const markAllRead = () =>
  request<void>('/api/notifications/read-all', { method: 'POST' })

export const deleteNotification = (id: number) =>
  request<void>(`/api/notifications/${id}`, { method: 'DELETE' })

export const getNotificationPrefs = () =>
  request<NotificationPrefs>('/api/notifications/prefs')

export const updateNotificationPrefs = (body: NotificationPrefsUpdate) =>
  request<NotificationPrefs>('/api/notifications/prefs', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
