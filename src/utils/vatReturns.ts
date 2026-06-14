import type { VatReturn } from '../types/entities.ts'

// Pure display helpers for VAT declarations (no hooks, no JSX).

const ORDINALS = ['1st', '2nd', '3rd', '4th']

export function quarterLabel(year: number, quarter: number): string {
  return `${ORDINALS[quarter - 1]} quarter ${year}`
}

// The most recent *ended* quarter — the default pick when filing.
export function previousQuarter(now = new Date()): { year: number; quarter: number } {
  const quarter = Math.floor(now.getMonth() / 3) + 1
  if (quarter === 1) return { year: now.getFullYear() - 1, quarter: 4 }
  return { year: now.getFullYear(), quarter: quarter - 1 }
}

export function outstandingCents(ret: VatReturn): number {
  return Math.abs(ret.net_cents ?? 0) - (ret.paid_cents ?? 0)
}

export interface VatReturnStatusMeta {
  color: string
  label: string
}

// Maps a return's derived status (+ due date) to the legend dot and label:
// green = fully settled, red = overdue, amber = filed and waiting on cash.
export function statusMeta(ret: VatReturn, today = new Date().toISOString().slice(0, 10)): VatReturnStatusMeta {
  switch (ret.status) {
    case 'paid': return { color: 'success.main', label: 'Paid' }
    case 'received': return { color: 'success.main', label: 'Received' }
    case 'settled': return { color: 'success.main', label: 'Settled' }
    case 'partially_paid': return { color: 'warning.main', label: 'Partially paid' }
    case 'partially_received': return { color: 'warning.main', label: 'Partially received' }
    case 'unpaid':
      if (ret.due_date && ret.due_date < today) return { color: 'error.main', label: 'Overdue' }
      return { color: 'warning.main', label: 'Ready to pay' }
    case 'not_received':
    default:
      return { color: 'warning.main', label: 'To receive' }
  }
}
