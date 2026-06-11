import { request } from './_client.js'
import { periodQueryString } from '../utils/invoicePeriod.js'

const api = (path, options) => request(`/api/ledger${path}`, options)

export const listLedger        = (period) => api(`/${periodQueryString(period)}`)
export const listLedgerPeriods = ()       => api('/periods')
export const getLedgerEntry    = (id)     => api(`/${id}`)
