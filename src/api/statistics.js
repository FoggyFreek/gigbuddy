import { request } from './_client.js'

// Active tenant's storage usage (tenant admin).
export const getMyStorageStats = () => request('/api/statistics/storage')

// Recompute the active tenant's usage and return the fresh row (tenant admin).
export const refreshMyStorageStats = () =>
  request('/api/statistics/storage/refresh', { method: 'POST' })

// Every tenant's storage usage (super admin).
export const getAllStorageStats = () => request('/api/admin/statistics/storage')

// Recompute usage for all tenants and return the refreshed list (super admin).
export const refreshAllStorageStats = () =>
  request('/api/admin/statistics/storage/refresh', { method: 'POST' })
