import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  applyVatTaxFactBackfill,
  previewVatTaxFactBackfill,
} from '../../api/tenants.ts'
import type {
  VatTaxFactBackfillLog,
  VatTaxFactBackfillResult,
} from '../../api/tenants.ts'
import type { Id } from '../../types/entities.ts'

interface BackfillTenant {
  id?: Id
  band_name?: string
}

interface Props {
  open: boolean
  tenant: BackfillTenant | null
  onClose: () => void
}

const startedLog = (mode: 'preview' | 'apply'): VatTaxFactBackfillLog => ({
  level: 'info',
  message: mode === 'preview'
    ? 'Preview started. Scanning the tenant ledger for VAT postings without tax facts.'
    : 'Apply started. Re-scanning under the tenant backfill lock.',
})

function errorLog(error: unknown): VatTaxFactBackfillLog {
  return {
    level: 'warning',
    message: error instanceof Error ? error.message : 'VAT tax-fact backfill failed.',
  }
}

function logColor(level: VatTaxFactBackfillLog['level']) {
  if (level === 'warning') return 'warning.main'
  if (level === 'success') return 'success.main'
  return 'text.secondary'
}

export default function VatTaxFactBackfillDialog({
  open,
  tenant,
  onClose,
}: Readonly<Props>) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<VatTaxFactBackfillResult | null>(null)
  const [logs, setLogs] = useState<VatTaxFactBackfillLog[]>([])

  useEffect(() => {
    if (!open || tenant?.id == null) return undefined
    let active = true
    setRunning(true)
    setResult(null)
    setLogs([startedLog('preview')])
    previewVatTaxFactBackfill(tenant.id)
      .then((preview) => {
        if (!active) return
        setResult(preview)
        setLogs((current) => [...current, ...preview.logs])
      })
      .catch((error: unknown) => {
        if (active) setLogs((current) => [...current, errorLog(error)])
      })
      .finally(() => {
        if (active) setRunning(false)
      })
    return () => {
      active = false
    }
  }, [open, tenant?.id])

  const handleApply = async () => {
    if (tenant?.id == null) return
    setRunning(true)
    setLogs((current) => [...current, startedLog('apply')])
    try {
      const applied = await applyVatTaxFactBackfill(tenant.id)
      setResult(applied)
      setLogs((current) => [...current, ...applied.logs])
    } catch (error) {
      setLogs((current) => [...current, errorLog(error)])
    } finally {
      setRunning(false)
    }
  }

  const canApply = !running
    && result?.mode === 'preview'
    && result.transactions_found > 0

  return (
    <Dialog
      open={open}
      onClose={running ? undefined : onClose}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>
        VAT tax-fact backfill — {tenant?.band_name ?? ''}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="warning">
            Apply creates one <strong>legacy_unclassified</strong> tax fact for each matching
            ledger transaction. It preserves the VAT control-account amounts, but cannot
            reconstruct mixed rates or categories. Review these facts in the VAT workpaper.
          </Alert>

          {result && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Result</Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 0.5, sm: 3 }}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
              >
                <Typography variant="body2">
                  Transactions found: <strong>{result.transactions_found}</strong>
                </Typography>
                <Typography variant="body2">
                  Inserted: <strong>{result.inserted}</strong>
                </Typography>
                <Typography variant="body2">
                  Assigned to submitted returns: <strong>{result.assigned_to_submitted_returns}</strong>
                </Typography>
                <Typography variant="body2">
                  Remaining: <strong>{result.remaining}</strong>
                </Typography>
              </Stack>
            </Paper>
          )}

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Logs</Typography>
            <Paper
              role="log"
              aria-live="polite"
              variant="outlined"
              sx={{
                bgcolor: 'background.default',
                maxHeight: 280,
                minHeight: 120,
                overflow: 'auto',
                p: 1.5,
              }}
            >
              <Stack spacing={0.75}>
                {logs.map((log, index) => (
                  <Typography
                    key={`${index}-${log.message}`}
                    component="div"
                    variant="caption"
                    sx={{ color: logColor(log.level), fontFamily: 'monospace' }}
                  >
                    [{log.level.toUpperCase()}] {log.message}
                  </Typography>
                ))}
                {running && (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <CircularProgress size={14} />
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                      Waiting for the server…
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </Paper>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={running}>Close</Button>
        <Button variant="contained" onClick={handleApply} disabled={!canApply}>
          Apply backfill
        </Button>
      </DialogActions>
    </Dialog>
  )
}
