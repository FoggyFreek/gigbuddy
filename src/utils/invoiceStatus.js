export function invoiceStatusColor(status) {
  switch (status) {
    case 'paid': return 'success'
    case 'sent': return 'info'
    case 'void': return 'default'
    default: return 'warning'
  }
}
