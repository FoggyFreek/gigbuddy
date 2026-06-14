import type { Id } from '../types/entities.ts'
import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import DateEntryField from './DateEntryField.tsx'
import SupplierAutocomplete from './purchases/SupplierAutocomplete.tsx'
import { emptyLine } from './purchases/purchaseFormHelpers.ts'
import { createPurchase } from '../api/purchases.ts'

// Collects the mandatory fields (supplier + receipt date), creates the draft
// purchase, then hands its id back so the page can open it in the split-view
// detail editor.

interface NewPurchaseDialogProps {
  onClose: () => void
  onCreated: (id: Id) => void
}

export default function NewPurchaseDialog({ onClose, onCreated }: NewPurchaseDialogProps) {
  const [supplierName, setSupplierName] = useState('')
  const [supplierContactId, setSupplierContactId] = useState<Id | null>(null)
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canContinue = supplierName.trim().length > 0 && Boolean(receiptDate) && !busy

  async function handleContinue() {
    if (!canContinue) return
    try {
      setBusy(true)
      setError(null)
      const created = await createPurchase({
        supplier_name: supplierName.trim(),
        supplier_contact_id: supplierContactId,
        receipt_date: receiptDate,
        due_date: null,
        currency: 'EUR',
        memo: null,
        status: 'draft',
        lines: [emptyLine(0)],
      })
      onCreated(created.id!)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New purchase</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pick a supplier and the receipt date to start. You can fill in the lines next.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Supplier</Typography>
          <SupplierAutocomplete
            value={supplierName}
            onChange={({ supplier_name, supplier_contact_id }) => {
              setSupplierName(supplier_name)
              setSupplierContactId(supplier_contact_id)
            }}
            label=""
            autoFocus
          />
        </Box>
        <Box>
          <DateEntryField
            label="Receipt date"
            size="small"
            fullWidth
            value={receiptDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiptDate(e.target.value)}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={!canContinue} onClick={handleContinue}>Continue</Button>
      </DialogActions>
    </Dialog>
  )
}
