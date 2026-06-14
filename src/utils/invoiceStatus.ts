export function invoiceStatusColor(status: string | null | undefined): string {
  switch (status) {
    case 'paid': return 'success'
    case 'sent': return 'info'
    case 'void': return 'default'
    default: return 'warning'
  }
}
