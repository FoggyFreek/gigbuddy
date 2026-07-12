import type { InvoiceStatus } from '../types/entities.ts'

export function invoiceStatusColor(status: string | null | undefined): string {
  switch (status) {
    case 'paid': return 'success'
    case 'sent': return 'info'
    case 'void': return 'default'
    default: return 'warning'
  }
}

// Forward-only status machine — mirrors ALLOWED_TRANSITIONS in
// server/services/invoiceService.js. Keep both in sync: once revenue/cash legs
// are posted a status can never regress, so paid and void are terminal.
export const INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['sent', 'paid', 'void'],
  sent: ['paid', 'void'],
  paid: [],
  void: [],
}
