import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation(['invoices', 'common'])
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{t($ => $.deleteDialog.title)}</DialogTitle>
      <DialogContent>
        {t($ => $.deleteDialog.body, { number: invoiceNumber || '' })}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t($ => $.common.actions.cancel)}</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>{t($ => $.common.actions.delete)}</Button>
      </DialogActions>
    </Dialog>
  )
}
