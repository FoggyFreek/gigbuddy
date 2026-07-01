import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import type { Product } from '../../types/entities.ts'

interface ArchiveProductDialogProps {
  product: Product
  onConfirm: () => void
  onClose: () => void
}

// Confirms archiving a product, spelling out the consequences: archiving is
// permanent (no unarchive), the product drops out of sale flows, but history stays.
export default function ArchiveProductDialog({ product, onConfirm, onClose }: ArchiveProductDialogProps) {
  const { t } = useTranslation(['merch', 'common'])
  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>{t($ => $.products.archiveConfirm.title)}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t($ => $.products.archiveConfirm.body, { name: product.name })}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>
          {t($ => $.products.archiveConfirm.confirm)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
