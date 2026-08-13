import { request } from '../../api/_client.ts'
import type { Account, AccountingSettings } from '../../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) => request<T>(`/api/accounts${path}`, options)

// A null name clears the tenant's override and restores the country default;
// the backend refuses it for accounts that aren't seeded.
export type AccountUpdate = Partial<Omit<Account, 'name'>> & { name?: string | null }

export const listAccounts = () => api<Account[]>('/')
export const createAccount = (body: Partial<Account>) => api<Account>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateAccount = (id: Account['id'], body: AccountUpdate) => api<Account>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteAccount = (id: Account['id']) => api<void>(`/${id}`, { method: 'DELETE' })
export const getAccountingSettings = () => api<AccountingSettings>('/settings')
export const updateAccountingSettings = (
  body: Partial<Omit<AccountingSettings, 'tenant_id' | 'currency'>>,
) => api<AccountingSettings>('/settings', { method: 'PATCH', body: JSON.stringify(body) })
