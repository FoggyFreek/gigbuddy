import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { leaveTenant } from '../../api/me.ts'
import { isApiError } from '../../types/api.ts'
import type { Id } from '../../types/entities.ts'

interface LeaveBandDialogProps {
  tenantId: Id
  bandName: string
  onClose: () => void
  onLeft: () => void
}

/**
 * Leaving a gigbuddy band from the artist's own workspace. A tenant must always
 * keep one admin, so the server refuses the last one — surfaced here as an
 * explanation of what to do instead, not a raw error.
 */
export default function LeaveBandDialog({
  tenantId, bandName, onClose, onLeft,
}: Readonly<LeaveBandDialogProps>) {
  const { t } = useTranslation(['myBands', 'common'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLeave() {
    setBusy(true)
    setError(null)
    try {
      await leaveTenant(tenantId)
      onLeft()
    } catch (e) {
      setError(isApiError(e) && e.code === 'last_tenant_admin'
        ? t($ => $.leave.lastAdmin)
        : (e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={busy ? undefined : onClose}>
      <DialogTitle>{t($ => $.leave.title, { name: bandName })}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography>{t($ => $.leave.body)}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" color="error" disabled={busy} onClick={handleLeave}>
          {t($ => $.leave.confirm)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
