import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'
import type { PrivateStorageConnection, StorageMigrationStatus } from '../types/api.ts'

const BASE = '/api/admin/storage-migrations'

export const getPrivateStorageConnection = () =>
  request<PrivateStorageConnection>(`${BASE}/connection`)

export const testPrivateStorageConnection = () =>
  request<PrivateStorageConnection>(`${BASE}/connection/test`, { method: 'POST' })

export const listStorageMigrations = () =>
  request<StorageMigrationStatus[]>(`${BASE}/tenants`)

export const getStorageMigration = (tenantId: Id) =>
  request<StorageMigrationStatus>(`${BASE}/tenants/${tenantId}`)

export const inventoryStorageMigration = (tenantId: Id) =>
  request<StorageMigrationStatus>(`${BASE}/tenants/${tenantId}/inventory`, { method: 'POST' })

export const copyStorageMigration = (tenantId: Id) =>
  request<StorageMigrationStatus>(`${BASE}/tenants/${tenantId}/copy`, { method: 'POST' })

export const validateStorageMigration = (tenantId: Id) =>
  request<StorageMigrationStatus>(`${BASE}/tenants/${tenantId}/validate`, { method: 'POST' })

export const deleteRustfsMigrationCopies = (
  tenantId: Id,
  confirmationSlug: string,
  confirmationPhrase: string,
) => request<StorageMigrationStatus>(`${BASE}/tenants/${tenantId}/delete-rustfs`, {
  method: 'POST',
  body: JSON.stringify({ confirmationSlug, confirmationPhrase }),
})
