import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

interface Props {
  initialName: string
  onCancel: () => void
  onConfirm: (name: string) => void
}

// A supplier column cell is a singleSelect, so the name of a supplier the bank
// did not name (unstructured MT940) is typed here instead.
export default function SupplierNameDialog({ initialName, onCancel, onConfirm }: Readonly<Props>) {
  const { t } = useTranslation('ledger')
  const [name, setName] = useState(initialName)
  const trimmed = name.trim()

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{t($ => $.bankImport.supplier.nameTitle)}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          sx={{ mt: 1 }}
          label={t($ => $.bankImport.supplier.name)}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && trimmed) onConfirm(trimmed) }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t($ => $.bankImport.cancel)}</Button>
        <Button variant="contained" disabled={!trimmed} onClick={() => onConfirm(trimmed)}>
          {t($ => $.bankImport.supplier.saveName)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
