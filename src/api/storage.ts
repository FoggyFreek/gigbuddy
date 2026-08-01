import { request } from './_client.ts'
import type { StorageConnection } from '../types/api.ts'

const BASE = '/api/admin/storage'

export const getStorageConnection = () =>
  request<StorageConnection>(`${BASE}/connection`)

export const testStorageConnection = () =>
  request<StorageConnection>(`${BASE}/connection/test`, { method: 'POST' })
