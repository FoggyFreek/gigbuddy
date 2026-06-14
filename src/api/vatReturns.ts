import { request } from './_client.ts'
import type { VatReturn, VatReturnPreview, VatReturnPayment, Id } from '../types/entities.ts'

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
