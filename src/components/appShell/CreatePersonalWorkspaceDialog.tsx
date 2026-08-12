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
import AccountingCountrySelect from '../shared/AccountingCountrySelect.tsx'
import { createPersonalTenant } from '../../api/tenants.ts'
import type { Id } from '../../types/entities.ts'

interface CreatePersonalWorkspaceDialogProps {
  open: boolean
  onClose: () => void
  /** Called with the new workspace's id so the caller can switch to it. */
  onCreated: (tenantId: Id) => void
  /** Prefills the name; the user can override it. */
  defaultName?: string
}

// Creating an artist workspace for someone who is already in the app: no plan
// step and no terms step (they have both), just the two facts creation needs —
// a name and the accounting country, which is immutable afterwards.
export default function CreatePersonalWorkspaceDialog({
  open, onClose, onCreated, defaultName = '',
}: Readonly<CreatePersonalWorkspaceDialogProps>) {
  const { t } = useTranslation(['onboarding', 'common'])
  const [name, setName] = useState(defaultName)
  const [countryCode, setCountryCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const tenant = await createPersonalTenant({
        display_name: name.trim(), country_code: countryCode,
      })
      if (tenant.id !== undefined) onCreated(tenant.id)
      onClose()
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code === 'tenant_onboarding_disabled'
        ? t($ => $.errors.onboardingDisabled)
        : t($ => $.errors.generic))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.workspace.personal.title)}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.kindChoice.personal.help)}
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t($ => $.workspace.personal.nameLabel)}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />

          <AccountingCountrySelect
            value={countryCode}
            onChange={setCountryCode}
            label={t($ => $.workspace.personal.countryLabel)}
            helperText={t($ => $.workspace.personal.countryHelper)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button
          variant="contained"
          disabled={busy || name.trim() === '' || countryCode === ''}
          onClick={() => { void handleCreate() }}
        >
          {t($ => $.workspace.personal.confirmFree)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
