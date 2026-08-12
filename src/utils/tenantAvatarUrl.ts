import type { Id } from '../types/entities.ts'

// Membership-authorized profile picture: readable for every tenant the user can
// see, unlike /api/files which only serves the *active* tenant. The one place
// this URL is built — the notification bell's legacy
// /api/notifications/tenant-avatar/:id still resolves, but nothing points there.
export function tenantAvatarUrl(tenantId?: Id, avatarPath?: string | null) {
  return tenantId != null && avatarPath ? `/api/tenants/${tenantId}/avatar` : undefined
}
