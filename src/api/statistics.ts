import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

interface StorageStats {
  tenant_id?: Id
  band_name?: string
  used_bytes?: number
  file_count?: number
  computed_at?: string
}

// Active tenant's storage usage (tenant admin).
export const getMyStorageStats = () => request<StorageStats>('/api/statistics/storage')

// Recompute the active tenant's usage and return the fresh row (tenant admin).
export const refreshMyStorageStats = () =>
  request<StorageStats>('/api/statistics/storage/refresh', { method: 'POST' })

// Every tenant's storage usage (super admin).
export const getAllStorageStats = () =>
  request<StorageStats[]>('/api/admin/statistics/storage')

// Recompute usage for all tenants and return the refreshed list (super admin).
export const refreshAllStorageStats = () =>
  request<StorageStats[]>('/api/admin/statistics/storage/refresh', { method: 'POST' })
