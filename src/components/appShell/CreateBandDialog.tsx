import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { createOwnedTenant } from '../../people/workspaces/tenants.ts'
import type { Id } from '../../types/entities.ts'
import AccountingCountrySelect from '../shared/AccountingCountrySelect.tsx'

interface CreateBandDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (tenantId: Id) => void
  defaultBandName?: string
}

export default function CreateBandDialog({
  open, onClose, onCreated, defaultBandName = '',
}: Readonly<CreateBandDialogProps>) {
  const { t } = useTranslation(['onboarding', 'common'])
  const [bandName, setBandName] = useState(defaultBandName)
  const [countryCode, setCountryCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetAndClose() {
    setBandName('')
    setCountryCode('')
    setError(null)
    onClose()
  }

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const tenant = await createOwnedTenant({
        band_name: bandName.trim(),
        country_code: countryCode,
      })
      if (tenant.id !== undefined) onCreated(tenant.id)
      resetAndClose()
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'tenant_onboarding_disabled') {
        setError(t($ => $.errors.onboardingDisabled))
      } else if (code === 'band_limit_reached') {
        setError(t($ => $.errors.bandCapReached))
      } else {
        setError(t($ => $.errors.generic))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : resetAndClose} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.workspace.band.title)}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.kindChoice.band.help)}
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t($ => $.workspace.band.nameLabel)}
            value={bandName}
            onChange={(event) => setBandName(event.target.value)}
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />

          <AccountingCountrySelect
            value={countryCode}
            onChange={setCountryCode}
            label={t($ => $.workspace.band.countryLabel)}
            helperText={t($ => $.workspace.band.countryHelper)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={resetAndClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button
          variant="contained"
          disabled={busy || bandName.trim() === '' || countryCode === ''}
          onClick={() => { void handleCreate() }}
        >
          {t($ => $.workspace.band.confirmFree)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
