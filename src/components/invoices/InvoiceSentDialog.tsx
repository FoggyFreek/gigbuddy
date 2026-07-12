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

interface InvoiceSentDialogProps {
  open: boolean
  invoiceNumber?: string
  onCancel: () => void
  onConfirm: () => void
}

export default function InvoiceSentDialog({ open, invoiceNumber, onCancel, onConfirm }: Readonly<InvoiceSentDialogProps>) {
  const { t } = useTranslation(['invoices', 'common'])
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{t($ => $.sentDialog.title, { number: invoiceNumber || '' })}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t($ => $.sentDialog.intro)}</DialogContentText>
        <List dense sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', pl: 0 }}>
            <ListItemText primary={t($ => $.sentDialog.finalized)} />
          </ListItem>
          <ListItem sx={{ display: 'list-item', pl: 0 }}>
            <ListItemText primary={t($ => $.sentDialog.ledger)} />
          </ListItem>
          <ListItem sx={{ display: 'list-item', pl: 0 }}>
            <ListItemText primary={t($ => $.sentDialog.forward)} />
          </ListItem>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" onClick={onConfirm}>{t($ => $.sentDialog.confirm)}</Button>
      </DialogActions>
    </Dialog>
  )
}
