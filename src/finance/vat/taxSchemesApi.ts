import { request } from '../../api/_client.ts'
import type { TaxSchemeEnrolment } from '../../types/entities.ts'

// The scheme history hangs off the accounting profile: "which scheme, since when"
// is the same settings concept as the regime it qualifies.
const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/accounting-profile/schemes${path}`, options)

export const listTaxSchemeEnrolments = () => api<TaxSchemeEnrolment[]>('')

export interface StartEnrolmentBody {
  scheme_code: string
  valid_from: string
  // INCLUSIVE last day. Omit for an open enrolment.
  valid_to?: string | null
  source_confirmation_date?: string | null
  // Only for a per-destination scheme (EU SME) — a national scheme always uses
  // the profile's own country and the server rejects an override.
  country_code?: string
}

export const startTaxSchemeEnrolment = (body: StartEnrolmentBody) =>
  api<TaxSchemeEnrolment>('', { method: 'POST', body: JSON.stringify(body) })

// Only the dates are editable: a different scheme is a different enrolment.
// Supplying them promotes a migration-inferred row to `confirmed`.
export type EnrolmentDatesPatch = Partial<Pick<TaxSchemeEnrolment,
  'valid_from' | 'valid_to' | 'source_confirmation_date'>>

export const updateTaxSchemeEnrolment = (id: number, body: EnrolmentDatesPatch) =>
  api<TaxSchemeEnrolment>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

// Voiding is how a wrong enrolment is retracted — corrections are forward-only,
// and the row explains the snapshots of documents issued under it.
export const voidTaxSchemeEnrolment = (id: number, reason?: string | null) =>
  api<TaxSchemeEnrolment>(`/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? null }),
  })

// Only accepted for a migration-inferred enrolment nothing depends on; the
// server 409s anything else.
export const deleteTaxSchemeEnrolment = (id: number) =>
  api<void>(`/${id}`, { method: 'DELETE' })
