import { request, requestBlob } from './_client.ts'
import type { LedgerEntryRow, LedgerEntryLineRow, LedgerLine, Period, Id } from '../types/entities.ts'
import { periodQueryString } from '../utils/invoicePeriod.ts'

interface LedgerEntry {
  id?: Id
  entry_date?: string
  description?: string
  source_type?: string
  source_id?: Id
  source_event?: string
  voided_at?: string
  lines?: LedgerLine[]
}

interface LedgerOverview {
  revenue_cents?: number
  expense_cents?: number
  net_cents?: number
  receivable_cents?: number
  payable_cents?: number
}

interface FinancialReport {
  accounts?: Array<{
    code?: string
    name?: string
    type?: string
    balance_cents?: number
  }>
  total_debit_cents?: number
  total_credit_cents?: number
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/ledger${path}`, options)

export const listLedger = (period: Period) => api<LedgerEntryRow[]>(`/${periodQueryString(period)}`)
export const listLedgerPeriods = () => api<string[]>('/periods')

// Global transaction search (min 3 chars) — same list-row shape as listLedger.
export const searchLedgerTransactions = (q: string) =>
  api<LedgerEntryRow[]>(`/search?${new URLSearchParams({ q })}`)

// Entry-line search by account: `accountCodes` already includes any selected
// parents' descendants, so it is sent as-is.
export const listLedgerEntries = (period: Period, accountCodes: string[]) => {
  const qs = periodQueryString(period)
  const sep = qs ? '&' : '?'
  return api<LedgerEntryLineRow[]>(`/entries${qs}${sep}accounts=${accountCodes.join(',')}`)
}
export const getLedgerOverview = (period: Period) =>
  api<LedgerOverview>(`/overview${periodQueryString(period)}`)
export const getLedgerEntry = (id: Id) => api<LedgerEntry>(`/${id}`)
export const getFinancialReport = (period: Period) =>
  api<FinancialReport>(`/report${periodQueryString(period)}`)
export const voidLedgerEntry = (id: Id) => api<LedgerEntry>(`/${id}/void`, { method: 'POST' })
export const reverseLedgerEntry = (id: Id) =>
  api<LedgerEntry>(`/${id}/reverse`, { method: 'POST' })

// format: 'xlsx' | 'pdf'
export const exportFinancialReport = (period: Period, format: 'xlsx' | 'pdf') => {
  const qs = periodQueryString(period)
  const sep = qs ? '&' : '?'
  return requestBlob(`/api/ledger/report/export${qs}${sep}format=${format}`, { method: 'GET' })
}
