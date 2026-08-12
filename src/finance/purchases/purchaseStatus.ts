// Maps a purchase status to an MUI Chip color. 'approved' is shown as a warning
// (unpaid) tone until payment is registered; the list page derives overdue/unpaid
// from the due date separately.
export function purchaseStatusColor(status: string | null | undefined): string {
  switch (status) {
    case 'paid': return 'success'
    case 'approved': return 'info'
    default: return 'warning'
  }
}
