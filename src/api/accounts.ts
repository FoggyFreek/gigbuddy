import { request } from './_client.ts'
import type { Account, AccountingSettings } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) => request<T>(`/api/accounts${path}`, options)

export const listAccounts = () => api<Account[]>('/')
export const createAccount = (body: Partial<Account>) => api<Account>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateAccount = (id: Account['id'], body: Partial<Account>) => api<Account>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteAccount = (id: Account['id']) => api<void>(`/${id}`, { method: 'DELETE' })
export const getAccountingSettings = () => api<AccountingSettings>('/settings')
export const updateAccountingSettings = (body: Partial<AccountingSettings>) => api<AccountingSettings>('/settings', { method: 'PATCH', body: JSON.stringify(body) })
