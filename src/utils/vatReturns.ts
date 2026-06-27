import type { VatQuarter, VatReturn } from '../types/entities.ts'

// Pure display helpers for VAT declarations (no hooks, no JSX).

const QUARTER_KEYS = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
} as const

export function quarterKey(quarter: VatQuarter): (typeof QUARTER_KEYS)[VatQuarter] {
  return QUARTER_KEYS[quarter]
}

// The most recent *ended* quarter — the default pick when filing.
export function previousQuarter(now = new Date()): { year: number; quarter: VatQuarter } {
  const quarter = Math.floor(now.getMonth() / 3) + 1
  if (quarter === 1) return { year: now.getFullYear() - 1, quarter: 4 }
  if (quarter === 2) return { year: now.getFullYear(), quarter: 1 }
  if (quarter === 3) return { year: now.getFullYear(), quarter: 2 }
  return { year: now.getFullYear(), quarter: 3 }
}

export function outstandingCents(ret: VatReturn): number {
  return Math.abs(ret.net_cents ?? 0) - (ret.paid_cents ?? 0)
}

export interface VatReturnStatusMeta {
  color: string
  statusKey: 'paid' | 'received' | 'settled' | 'partially_paid' | 'partially_received' | 'overdue' | 'ready_to_pay' | 'to_receive'
}

// Maps a return's derived status (+ due date) to the legend dot and label:
// green = fully settled, red = overdue, amber = filed and waiting on cash.
export function statusMeta(ret: VatReturn, today = new Date().toISOString().slice(0, 10)): VatReturnStatusMeta {
  switch (ret.status) {
    case 'paid': return { color: 'success.main', statusKey: 'paid' }
    case 'received': return { color: 'success.main', statusKey: 'received' }
    case 'settled': return { color: 'success.main', statusKey: 'settled' }
    case 'partially_paid': return { color: 'warning.main', statusKey: 'partially_paid' }
    case 'partially_received': return { color: 'warning.main', statusKey: 'partially_received' }
    case 'unpaid':
      if (ret.due_date && ret.due_date < today) return { color: 'error.main', statusKey: 'overdue' }
      return { color: 'warning.main', statusKey: 'ready_to_pay' }
    case 'not_received':
    default:
      return { color: 'warning.main', statusKey: 'to_receive' }
  }
}
