import { request } from './_client.ts'
import type { FinanceOnboardingStatus, Id } from '../types/entities.ts'

// Whether the active tenant has an opening balance yet — gates the finance
// welcome tutorial and the bank-import opening-balance nudge.
export function getFinanceOnboardingStatus(): Promise<FinanceOnboardingStatus> {
  return request<FinanceOnboardingStatus>('/api/finance-onboarding/status')
}

// Posts a manual opening balance. `amountCents` is signed (positive = a normal
// positive bank balance, negative = overdrawn).
export function setOpeningBalance(
  input: { amountCents: number; entryDate: string },
): Promise<{ posted: boolean; transactionId: Id }> {
  return request('/api/finance-onboarding/opening-balance', {
    method: 'POST',
    body: JSON.stringify({ amount_cents: input.amountCents, entry_date: input.entryDate }),
  })
}
