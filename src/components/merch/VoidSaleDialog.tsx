import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import type { MerchSale } from '../../types/entities.ts'

interface VoidSaleDialogProps {
  sale: MerchSale
  onConfirm: () => void
  onClose: () => void
}

export default function VoidSaleDialog({ sale, onConfirm, onClose }: VoidSaleDialogProps) {
  const { t } = useTranslation(['merch', 'common'])
  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>{t($ => $.void.title)}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t($ => $.void.body, { qty: sale.quantity, name: sale.product_name })}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>{t($ => $.void.confirm)}</Button>
      </DialogActions>
    </Dialog>
  )
}
