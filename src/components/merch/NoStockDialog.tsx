import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'

interface NoStockDialogProps {
  onClose: () => void
}

// Shown when a band tries to record a sale but no product has stock on hand,
// explaining the add-product → purchase → sale flow that builds up inventory.
export default function NoStockDialog({ onClose }: NoStockDialogProps) {
  const { t } = useTranslation('merch')
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t($ => $.noStock.title)}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t($ => $.noStock.intro)}</DialogContentText>
        <Box component="ol" sx={{ mt: 1.5, mb: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <li>{t($ => $.noStock.step1)}</li>
          <li>{t($ => $.noStock.step2)}</li>
          <li>{t($ => $.noStock.step3)}</li>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>{t($ => $.noStock.close)}</Button>
      </DialogActions>
    </Dialog>
  )
}
