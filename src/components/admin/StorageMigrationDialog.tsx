import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { Id } from '../../types/entities.ts'
import type { StorageMigrationState, StorageMigrationStatus } from '../../types/api.ts'
import {
  copyStorageMigration,
  deleteRustfsMigrationCopies,
  getStorageMigration,
  inventoryStorageMigration,
  validateStorageMigration,
} from '../../api/storageMigrations.ts'
import { formatBytes } from '../../utils/formatBytes.ts'

interface TenantSummary {
  id?: Id
  slug?: string
  band_name?: string
}

interface Props {
  open: boolean
  tenant: TenantSummary | null
  initialStatus?: StorageMigrationStatus | null
  onClose: () => void
  onStatusChange: (status: StorageMigrationStatus) => void
}

const ACTIVE_STATES = new Set<StorageMigrationState>([
  'inventorying', 'copying', 'validating', 'deleting_source',
])

function stateColor(state: StorageMigrationState): 'default' | 'info' | 'success' | 'warning' | 'error' {
  if (state === 'complete' || state === 'verified' || state === 'not_required') return 'success'
  if (state.endsWith('_failed')) return 'error'
  if (ACTIVE_STATES.has(state)) return 'info'
  if (state === 'ready_to_copy' || state === 'copied') return 'warning'
  return 'default'
}

export default function StorageMigrationDialog({ open, tenant, initialStatus, onClose, onStatusChange }: Props) {
  const [status, setStatus] = useState<StorageMigrationStatus | null>(initialStatus ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationSlug, setConfirmationSlug] = useState('')
  const [confirmationPhrase, setConfirmationPhrase] = useState('')

  const load = async () => {
    if (!tenant?.id) return
    try {
      const next = await getStorageMigration(tenant.id)
      setStatus(next)
      onStatusChange(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load migration status')
    }
  }

  useEffect(() => {
    if (!open || !tenant) return undefined
    setStatus(initialStatus ?? null)
    setError('')
    setConfirmingDelete(false)
    setConfirmationSlug('')
    setConfirmationPhrase('')
    void load()
    return undefined
    // Loading is keyed to the selected tenant; callbacks intentionally do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenant?.id])

  useEffect(() => {
    if (!open || !status || !ACTIVE_STATES.has(status.state)) return undefined
    const timer = window.setInterval(() => { void load() }, 2000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status?.state, tenant?.id])

  const run = async (operation: () => Promise<StorageMigrationStatus>) => {
    setLoading(true)
    setError('')
    try {
      const next = await operation()
      setStatus(next)
      onStatusChange(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setLoading(false)
    }
  }

  const state = status?.state ?? 'not_scanned'
  const canCopy = ['ready_to_copy', 'copy_failed', 'copied', 'validation_failed'].includes(state)
  const canValidate = ['copied', 'validation_failed', 'verified'].includes(state)
  const canDelete = state === 'verified' || state === 'delete_failed'
  const deleteConfirmed = confirmationSlug === tenant?.slug && confirmationPhrase === 'DELETE RUSTFS COPIES'

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Storage migration — {tenant?.band_name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography sx={{ flexGrow: 1 }}>Current state</Typography>
            <Chip label={state.replaceAll('_', ' ')} color={stateColor(state)} size="small" />
          </Stack>
          {status && (
            <Box>
              <Typography variant="body2">RustFS tenant data: {status.source_object_count} objects · {formatBytes(status.source_bytes)}</Typography>
              <Typography variant="body2">Copied: {status.copied_object_count} objects · {formatBytes(status.copied_bytes)}</Typography>
              <Typography variant="body2">Missing: {status.missing_object_count} · Mismatches: {status.mismatch_count}</Typography>
              {status.validated_at && <Typography variant="caption">Validated {new Date(status.validated_at).toLocaleString()}</Typography>}
            </Box>
          )}
          {status?.error_code && <Alert severity="error">Migration failed: {status.error_code.replaceAll('_', ' ')}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          <Divider />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant="outlined"
              disabled={loading || ACTIVE_STATES.has(state)}
              onClick={() => tenant?.id && void run(() => inventoryStorageMigration(tenant.id as Id))}
            >
              1. Inventory
            </Button>
            <Button
              variant="outlined"
              disabled={loading || !canCopy}
              onClick={() => tenant?.id && void run(() => copyStorageMigration(tenant.id as Id))}
            >
              2. Copy to Backblaze
            </Button>
            <Button
              variant="outlined"
              disabled={loading || !canValidate}
              onClick={() => tenant?.id && void run(() => validateStorageMigration(tenant.id as Id))}
            >
              3. Validate copy
            </Button>
          </Stack>
          <Divider />
          {!confirmingDelete ? (
            <Button color="error" variant="outlined" disabled={loading || !canDelete} onClick={() => setConfirmingDelete(true)}>
              4. Delete tenant copies from RustFS
            </Button>
          ) : (
            <Stack spacing={1.5}>
              <Alert severity="warning">
                This removes all validated tenant object copies from RustFS. PostgreSQL records and Backblaze objects remain.
              </Alert>
              <TextField
                label={`Type ${tenant?.slug} to confirm`}
                value={confirmationSlug}
                onChange={(event) => setConfirmationSlug(event.target.value)}
              />
              <TextField
                label="Type DELETE RUSTFS COPIES"
                value={confirmationPhrase}
                onChange={(event) => setConfirmationPhrase(event.target.value)}
              />
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
                <Button
                  color="error"
                  variant="contained"
                  disabled={loading || !deleteConfirmed}
                  onClick={() => tenant?.id && void run(() => deleteRustfsMigrationCopies(
                    tenant.id as Id,
                    confirmationSlug,
                    confirmationPhrase,
                  ))}
                >
                  Delete RustFS copies
                </Button>
              </Stack>
            </Stack>
          )}
          {loading && <CircularProgress size={24} aria-label="storage migration running" />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
