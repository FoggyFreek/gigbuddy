import type { Id } from '../types/entities.ts'

export function tenantAvatarUrl(tenantId?: Id, avatarPath?: string | null) {
  return tenantId != null && avatarPath ? `/api/notifications/tenant-avatar/${tenantId}` : undefined
}
