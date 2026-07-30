import { request } from './_client.ts'
import type { AccountingProfile } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/accounting-profile${path}`, options)

export const getAccountingProfile = () => api<AccountingProfile>('/')

// Only the facts a band states about itself are patchable. The rest of the row is
// immutable (country, and the currency derived from it), a product fact
// (entity_size, financial_accounting_basis), derived from a patchable field
// (legal_form, reporting_framework_code, vat_accounting_basis) or server-computed
// (status, source, review columns).
export type AccountingProfilePatch = Partial<Pick<AccountingProfile,
  'local_legal_form_code' | 'local_legal_form_label' | 'vat_registered'
  | 'vat_filing_frequency' | 'financial_year_start_month' | 'financial_year_start_day'>>

export const updateAccountingProfile = (body: AccountingProfilePatch) =>
  api<AccountingProfile>('/', { method: 'PATCH', body: JSON.stringify(body) })

// Records that a human confirmed the profile's values. Only accepted once every
// field is answered.
export const confirmAccountingProfile = () =>
  api<AccountingProfile>('/review', { method: 'POST' })
