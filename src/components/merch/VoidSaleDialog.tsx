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
  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>Void this sale?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          A reversing entry is posted to the ledger, undoing the recorded revenue
          and cost, and {sale.quantity} × {sale.product_name} goes back in stock.
          Voiding is permanent.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Void sale</Button>
      </DialogActions>
    </Dialog>
  )
}
