import PropTypes from 'prop-types'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'

export default function InvoiceVoidDialog({ open, invoiceNumber, hasPaymentLink, wasSent, onCancel, onConfirm }) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>Void invoice {invoiceNumber}?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Voiding this invoice has the following consequences:
        </DialogContentText>
        <List dense sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', pl: 0 }}>
            <ListItemText primary="The invoice can no longer be edited, sent or paid — voiding is permanent." />
          </ListItem>
          {wasSent && (
            <ListItem sx={{ display: 'list-item', pl: 0 }}>
              <ListItemText primary="A reversing entry is posted to the ledger, undoing the recorded revenue and receivable." />
            </ListItem>
          )}
          {hasPaymentLink && (
            <ListItem sx={{ display: 'list-item', pl: 0 }}>
              <ListItemText primary="The Mollie payment link is removed; the customer can no longer pay through it. If it turns out to have been paid already, the invoice is marked paid instead of voided." />
            </ListItem>
          )}
          <ListItem sx={{ display: 'list-item', pl: 0 }}>
            <ListItemText primary="To correct a mistake, void this invoice and create a new one." />
          </ListItem>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Void invoice</Button>
      </DialogActions>
    </Dialog>
  )
}

InvoiceVoidDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  invoiceNumber: PropTypes.string,
  hasPaymentLink: PropTypes.bool,
  wasSent: PropTypes.bool,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
}
