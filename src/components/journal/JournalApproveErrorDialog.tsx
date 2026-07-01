import { useTranslation } from 'react-i18next'
import type { Journal, Id } from '../../types/entities.ts'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'

interface ApproveError {
  id?: Id
  error?: string
  code?: string
  line?: number
}

interface JournalApproveErrorDialogProps {
  errors: ApproveError[]
  journals: Journal[]
  onClose: () => void
}

export default function JournalApproveErrorDialog({ errors, journals, onClose }: Readonly<JournalApproveErrorDialogProps>) {
  const { t } = useTranslation(['journal', 'common'])

  // Friendly explanation per backend error code; falls back to the server message.
  const codeMessages: Record<string, string> = {
    unbalanced_journal: t($ => $.approveErrors.codes.unbalanced_journal),
    invalid_account_code: t($ => $.approveErrors.codes.invalid_account_code),
    missing_side: t($ => $.approveErrors.codes.missing_side),
    invalid_amount: t($ => $.approveErrors.codes.invalid_amount),
    invalid_balancing_account: t($ => $.approveErrors.codes.invalid_balancing_account),
    accounting_not_configured: t($ => $.approveErrors.codes.accounting_not_configured),
    no_lines: t($ => $.approveErrors.codes.no_lines),
    already_approved: t($ => $.approveErrors.codes.already_approved),
  }

  const reasonFor = (err: ApproveError): string => {
    const base = codeMessages[err.code ?? ''] || err.error || t($ => $.approveErrors.fallback)
    return err.line ? t($ => $.approveErrors.linePrefix, { line: err.line, message: base }) : base
  }

  const labelFor = (id: Id | undefined) => {
    const j = journals.find((x) => x.id === id)
    return j ? t($ => $.approveErrors.entryLabel, { number: j.entry_number }) : t($ => $.approveErrors.entryLabelFallback, { id })
  }

  return (
    <Dialog open={errors.length > 0} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t($ => $.approveErrors.title)}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          {t($ => $.approveErrors.summary, { count: errors.length })}
        </DialogContentText>
        <List dense disablePadding>
          {errors.map((err, i) => (
            <ListItem key={err.id ?? i} disableGutters alignItems="flex-start">
              <ListItemIcon sx={{ minWidth: 32, mt: 0.5 }}>
                <ErrorOutlineIcon color="error" fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={labelFor(err.id)} secondary={reasonFor(err)} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">{t($ => $.actions.ok, { ns: 'common' })}</Button>
      </DialogActions>
    </Dialog>
  )
}
