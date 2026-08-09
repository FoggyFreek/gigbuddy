import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { deleteManagedTenant } from '../../api/tenants.ts'
import { useAuth } from '../../contexts/authContext.ts'

export default function TenantDeletionSection() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [confirmationName, setConfirmationName] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tenantId = user?.activeTenantId ?? null
  const membership = user?.memberships?.find((item) => item.tenantId === tenantId)
  const accountName = membership?.displayName ?? membership?.tenantName ?? membership?.tenantSlug ?? ''
  const canDelete = Boolean(accountName) && confirmationName === accountName && acknowledged && !submitting

  if (tenantId === null || !accountName) return null

  const reset = () => {
    setConfirmationName('')
    setAcknowledged(false)
    setError(null)
  }

  const handleOpen = () => {
    reset()
    setOpen(true)
  }

  const handleClose = () => {
    if (submitting) return
    setOpen(false)
    reset()
  }

  const handleDelete = async () => {
    if (!canDelete) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteManagedTenant(tenantId, { confirmationName, acknowledged: true })
      setOpen(false)
      reset()
      // The destructive request has already succeeded; a transient /auth/me
      // refresh failure must not present the completed deletion as failed.
      await refreshUser().catch(() => undefined)
      navigate('/', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t($ => $.tenantDeletion.failed))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {t($ => $.tenantDeletion.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t($ => $.tenantDeletion.description)}
      </Typography>
      <Button color="error" variant="outlined" onClick={handleOpen}>
        {t($ => $.tenantDeletion.open)}
      </Button>

      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>{t($ => $.tenantDeletion.dialogTitle, { name: accountName })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Alert severity="error">{t($ => $.tenantDeletion.warning)}</Alert>
            <Alert severity="warning">{t($ => $.tenantDeletion.downloadWarning)}</Alert>
            <DialogContentText>{t($ => $.tenantDeletion.confirmationHelp, { name: accountName })}</DialogContentText>
            <TextField
              autoFocus
              fullWidth
              label={t($ => $.tenantDeletion.confirmationLabel, { name: accountName })}
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              disabled={submitting}
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={submitting}
                />
              )}
              label={t($ => $.tenantDeletion.acknowledgement)}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={submitting}>
            {t($ => $.actions.cancel, { ns: 'common' })}
          </Button>
          <Button color="error" variant="contained" disabled={!canDelete} onClick={handleDelete}>
            {t($ => $.tenantDeletion.confirm)}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
