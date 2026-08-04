import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { ApplyPrompt } from './decisions.ts'

interface Props {
  prompt: ApplyPrompt
  onApply: () => void
  onDismiss: () => void
}

export function ApplyToRelationDialog({ prompt, onApply, onDismiss }: Readonly<Props>) {
  const { t } = useTranslation('ledger')
  const field = prompt.patch.field
  const copy = prompt.kind

  return (
    <Dialog open onClose={onDismiss} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t($ => $.bankImport.applyToRelation[field][copy].title, { name: prompt.relationName })}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          {t($ => $.bankImport.applyToRelation[field][copy].body, {
            count: prompt.lineIds.length,
            name: prompt.relationName,
            value: prompt.valueLabel,
          })}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDismiss}>{t($ => $.bankImport.applyToRelation.keepSingle)}</Button>
        <Button variant="contained" onClick={onApply}>
          {t($ => $.bankImport.applyToRelation.applyAll)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
