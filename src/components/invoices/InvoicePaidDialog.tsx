import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'

interface InvoicePaidDialogProps {
  open: boolean
  invoiceNumber?: string
  onCancel: () => void
  onConfirm: () => void
}

export default function InvoicePaidDialog({ open, invoiceNumber, onCancel, onConfirm }: Readonly<InvoicePaidDialogProps>) {
  const { t } = useTranslation(['invoices', 'common'])
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{t($ => $.paidDialog.title, { number: invoiceNumber || '' })}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t($ => $.paidDialog.body)}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" onClick={onConfirm}>{t($ => $.paidDialog.confirm)}</Button>
      </DialogActions>
    </Dialog>
  )
}
