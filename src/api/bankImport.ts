import { request, requestForm } from './_client.ts'
import type {
  Id, BankImportParseResult, BankImportDecision, BankImportResult,
} from '../types/entities.ts'

// Upload a CAMT.053/MT940 statement file; the server parses and stages it,
// returning the staged lines with per-line reconciliation/supplier suggestions.
export function parseBankStatement(file: File): Promise<BankImportParseResult> {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm<BankImportParseResult>('/api/bank-import/parse', fd)
}

export function getBankImport(id: Id): Promise<BankImportParseResult> {
  return request<BankImportParseResult>(`/api/bank-import/${id}`)
}

export function cancelBankImport(id: Id): Promise<void> {
  return request<void>(`/api/bank-import/${id}`, { method: 'DELETE' })
}

export function commitBankImport(id: Id, decisions: BankImportDecision[]): Promise<BankImportResult> {
  return request<BankImportResult>(`/api/bank-import/${id}/commit`, {
    method: 'POST',
    body: JSON.stringify({ decisions }),
  })
}

// Sets the tenant opening balance from this staged import's opening-balance value.
export function setOpeningBalanceFromImport(id: Id): Promise<{ posted: boolean; transactionId: Id }> {
  return request(`/api/bank-import/${id}/opening-balance`, { method: 'POST' })
}
