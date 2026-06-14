import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'

interface InvoiceDeleteDialogProps {
  open: boolean
  invoiceNumber?: string
  onCancel: () => void
  onConfirm: () => void
}

export default function InvoiceDeleteDialog({ open, invoiceNumber, onCancel, onConfirm }: InvoiceDeleteDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>Delete invoice?</DialogTitle>
      <DialogContent>
        Delete invoice {invoiceNumber}? Cannot be undone.
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Delete</Button>
      </DialogActions>
    </Dialog>
  )
}
