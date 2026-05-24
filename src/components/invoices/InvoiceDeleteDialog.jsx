import PropTypes from 'prop-types'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'

export default function InvoiceDeleteDialog({ open, invoiceNumber, onCancel, onConfirm }) {
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

InvoiceDeleteDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  invoiceNumber: PropTypes.string,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
}
