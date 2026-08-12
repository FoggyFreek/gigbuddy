import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'

interface InvoiceVoidDialogProps {
  open: boolean
  invoiceNumber?: string
  hasPaymentLink?: boolean
  wasSent?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function InvoiceVoidDialog({ open, invoiceNumber, hasPaymentLink, wasSent, onCancel, onConfirm }: Readonly<InvoiceVoidDialogProps>) {
  const { t } = useTranslation(['invoices', 'common'])
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{t($ => $.voidDialog.title, { number: invoiceNumber || '' })}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t($ => $.voidDialog.intro)}
        </DialogContentText>
        <List dense sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', pl: 0 }}>
            <ListItemText primary={t($ => $.voidDialog.permanent)} />
          </ListItem>
          {wasSent && (
            <ListItem sx={{ display: 'list-item', pl: 0 }}>
              <ListItemText primary={t($ => $.voidDialog.ledgerReversal)} />
            </ListItem>
          )}
          {hasPaymentLink && (
            <ListItem sx={{ display: 'list-item', pl: 0 }}>
              <ListItemText primary={t($ => $.voidDialog.paymentLinkRemoved)} />
            </ListItem>
          )}
          <ListItem sx={{ display: 'list-item', pl: 0 }}>
            <ListItemText primary={t($ => $.voidDialog.correction)} />
          </ListItem>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t($ => $.common.actions.cancel)}</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>{t($ => $.voidDialog.confirm)}</Button>
      </DialogActions>
    </Dialog>
  )
}
