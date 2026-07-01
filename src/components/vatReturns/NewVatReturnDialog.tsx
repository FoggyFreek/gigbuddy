import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { previewVatReturn, createVatReturn } from '../../api/vatReturns.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import { previousQuarter, quarterKey } from '../../utils/vatReturns.ts'
import type { VatQuarter, VatReturn, VatReturnPreview } from '../../types/entities.ts'

const QUARTERS = [1, 2, 3, 4] as const

function yearOptions() {
  const current = new Date().getFullYear()
  return [current - 2, current - 1, current]
}

interface NewVatReturnDialogProps {
  onFiled: (vatReturn: VatReturn) => void
  onClose: () => void
}

// Picks a quarter, previews the running VAT position (output − input) and
// files the declaration: the backend posts the settlement journal and closes
// the books through the period end.
export default function NewVatReturnDialog({ onFiled, onClose }: Readonly<NewVatReturnDialogProps>) {
  const { t, i18n } = useTranslation(['vatReturns', 'common'])
  const [{ year, quarter }, setPeriod] = useState<{ year: number; quarter: VatQuarter }>(() => previousQuarter())
  const [years] = useState(() => yearOptions())
  const [lastPreview, setLastPreview] = useState<VatReturnPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset the error during render when the period changes (React's
  // adjust-state-on-prop-change pattern); the stale preview needs no reset —
  // it is ignored below until the fetch for the current period lands.
  const [prevPeriod, setPrevPeriod] = useState({ year, quarter })
  if (prevPeriod.year !== year || prevPeriod.quarter !== quarter) {
    setPrevPeriod({ year, quarter })
    setError(null)
  }

  useEffect(() => {
    let active = true
    previewVatReturn(year, quarter)
      .then((p) => active && setLastPreview(p))
      .catch((e: Error) => active && setError(e.message))
    return () => { active = false }
  }, [year, quarter])

  const preview: VatReturnPreview | null =
    lastPreview?.year === year && lastPreview?.quarter === quarter ? lastPreview : null

  const nothingToSettle = preview?.output_vat_cents === 0 && preview?.input_vat_cents === 0
  const canFile = Boolean(preview) && preview!.period_ended && !nothingToSettle && !busy
  const direction = preview?.direction ?? 'nil'
  const periodLabel = t($ => $.quarters[quarterKey(quarter)], { year })
  const locale = i18n.resolvedLanguage

  async function handleFile() {
    if (!canFile) return
    try {
      setBusy(true)
      setError(null)
      onFiled(await createVatReturn({ year, quarter }))
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t($ => $.newDialog.title)}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
          <TextField
            label={t($ => $.fields.year)}
            size="small"
            select
            fullWidth
            value={year}
            onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
          >
            {years.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
          <TextField
            label={t($ => $.fields.quarter)}
            size="small"
            select
            fullWidth
            value={quarter}
            onChange={(e) => setPeriod((p) => ({ ...p, quarter: Number(e.target.value) as VatQuarter }))}
          >
            {QUARTERS.map((q) => <MenuItem key={q} value={q}>Q{q}</MenuItem>)}
          </TextField>
        </Box>

        {!preview && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {preview && (
          <>
            <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
              {t($ => $.newDialog.previewDue, {
                period: periodLabel,
                date: formatShortDate(preview.due_date, locale),
              })}
            </Typography>
            <Box data-testid="vat-preview-output" data-cents={preview.output_vat_cents ?? 0} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">{t($ => $.fields.outputVat)}</Typography>
              <Typography variant="body2">{formatEur(preview.output_vat_cents)}</Typography>
            </Box>
            <Box data-testid="vat-preview-input" data-cents={preview.input_vat_cents ?? 0} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2">{t($ => $.fields.inputVat)}</Typography>
              <Typography variant="body2">− {formatEur(preview.input_vat_cents)}</Typography>
            </Box>
            <Divider sx={{ mb: 1 }} />
            <Box data-testid="vat-preview-net" data-cents={preview.net_cents ?? 0} data-direction={direction} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 2 }}>
              <Typography variant="subtitle2">{t($ => $.direction[direction])}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {formatEur(Math.abs(preview.net_cents ?? 0))}
              </Typography>
            </Box>

            {!preview.period_ended && (
              <Alert data-testid="vat-quarter-not-ended" severity="info" sx={{ mb: 1 }}>
                {t($ => $.newDialog.quarterNotEnded, { date: formatShortDate(preview.period_to, locale) })}
              </Alert>
            )}
            {preview.period_ended && nothingToSettle && (
              <Alert severity="info" sx={{ mb: 1 }}>{t($ => $.newDialog.nothingAccumulated)}</Alert>
            )}
            {canFile && (
              <Alert severity="warning">
                {t($ => $.newDialog.filingWarning, { date: formatShortDate(preview.period_to, locale) })}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button data-testid="settle-vat-quarter" variant="contained" disabled={!canFile} onClick={handleFile}>
          {t($ => $.actions.settleQuarter)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
