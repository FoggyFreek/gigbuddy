import { request } from './_client.ts'
import type {
  VatExceptionAcknowledgement,
  VatReturn,
  VatReturnPreview,
  VatReturnPayment,
  Id,
} from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/vat-returns${path}`, options)

export const listVatReturns = () => api<VatReturn[]>('')
export const previewVatReturn = (year: number, quarter: number) =>
  api<VatReturnPreview>(`/preview?year=${year}&quarter=${quarter}`)
export const createVatReturn = (body: Partial<VatReturn>) =>
  api<VatReturn>('', { method: 'POST', body: JSON.stringify(body) })
export const getVatReturn = (id: Id) => api<VatReturn>(`/${id}`)
export const recordVatPayment = (id: Id, body: Partial<VatReturnPayment>) =>
  api<VatReturn>(`/${id}/payments`, { method: 'POST', body: JSON.stringify(body) })
export const submitVatReturn = (id: Id, submissionReference: string) =>
  api<VatReturn>(`/${id}/submit`, {
    method: 'POST',
    body: JSON.stringify({ submission_reference: submissionReference }),
  })
export const acknowledgeVatException = (id: Id, exceptionKey: string, note: string) =>
  api<VatExceptionAcknowledgement>(`/${id}/exceptions/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ exception_key: exceptionKey, note }),
  })
