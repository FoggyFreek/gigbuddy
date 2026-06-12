import { request, requestBlob } from './_client.js'
import { periodQueryString } from '../utils/invoicePeriod.js'

const api = (path, options) => request(`/api/ledger${path}`, options)

export const listLedger         = (period) => api(`/${periodQueryString(period)}`)
export const listLedgerPeriods  = ()       => api('/periods')
export const getLedgerOverview  = (period) => api(`/overview${periodQueryString(period)}`)
export const getLedgerEntry     = (id)     => api(`/${id}`)
export const getFinancialReport = (period) => api(`/report${periodQueryString(period)}`)
export const voidLedgerEntry    = (id)     => api(`/${id}/void`, { method: 'POST' })

// format: 'xlsx' | 'pdf'
export const exportFinancialReport = (period, format) => {
  const qs = periodQueryString(period)
  const sep = qs ? '&' : '?'
  return requestBlob(`/api/ledger/report/export${qs}${sep}format=${format}`, { method: 'GET' })
}
