import Alert from '@mui/material/Alert'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import EmailIcon from '@mui/icons-material/Email'

interface InvoiceEmlDialogProps {
  open: boolean
  loading?: boolean
  busy?: boolean
  error?: string
  message?: string
  onMessageChange: (value: string) => void
  onClose: () => void
  onDownload: () => void
}

export default function InvoiceEmlDialog({
  open, loading, busy, error, message, onMessageChange, onClose, onDownload,
}: InvoiceEmlDialogProps) {
  const { t } = useTranslation(['invoices', 'common'])
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.emailDialog.title)}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading
          ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          : (
            <TextField
              multiline
              fullWidth
              minRows={5}
              maxRows={12}
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              disabled={busy}
              sx={{ mt: 1 }}
              helperText={t($ => $.emailDialog.helperText)}
            />
          )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button
          variant="contained"
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <EmailIcon />}
          onClick={onDownload}
          disabled={loading || busy}
        >
          {t($ => $.detail.downloadEmail)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
