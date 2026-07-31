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
import {
  confirmVatTaxFact,
  previewVatReturn,
  createVatReturn,
} from '../../api/vatReturns.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import { previousQuarter, quarterKey } from '../../utils/vatReturns.ts'
import { useAccountingProfile } from '../../contexts/accountingProfileContext.ts'
import type { VatQuarter, VatReturn, VatReturnPreview, VatTaxFact } from '../../types/entities.ts'
import VatTaxFactReviewList, { type VatFactClassification } from './VatTaxFactReviewList.tsx'
import VatBoxesTable from './VatBoxesTable.tsx'

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
  const currency = useAccountingProfile().profile?.base_currency ?? 'EUR'
  const { t, i18n } = useTranslation(['vatReturns', 'common'])
  const [{ year, quarter }, setPeriod] = useState<{ year: number; quarter: VatQuarter }>(() => previousQuarter())
  const [years] = useState(() => yearOptions())
  const [lastPreview, setLastPreview] = useState<VatReturnPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)

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
  }, [year, quarter, refresh])

  useEffect(() => {
    const refreshAfterExternalCorrection = () => {
      setLastPreview(null)
      setError(null)
      setRefresh((value) => value + 1)
    }
    window.addEventListener('focus', refreshAfterExternalCorrection)
    return () => window.removeEventListener('focus', refreshAfterExternalCorrection)
  }, [])

  const preview: VatReturnPreview | null =
    lastPreview?.year === year && lastPreview?.quarter === quarter ? lastPreview : null

  const isWorkpaper = preview?.calculation_mode === 'category_workpaper'
  const reviewFacts = preview?.facts?.filter((fact) => fact.classification_status !== 'confirmed') ?? []
  const nothingToSettle = isWorkpaper
    ? preview?.facts?.length === 0
    : preview?.output_vat_cents === 0 && preview?.input_vat_cents === 0
  const canFile = Boolean(preview) && preview!.period_ended
    && !nothingToSettle && reviewFacts.length === 0 && !busy
  const direction = preview?.direction ?? 'nil'
  const periodLabel = t($ => $.quarters[quarterKey(quarter)], { year })
  const locale = i18n.resolvedLanguage

  async function handleFile() {
    if (!canFile) return
    try {
      setBusy(true)
      setError(null)
      onFiled(await createVatReturn({
        year,
        quarter,
        ...(isWorkpaper ? { calculation_mode: 'category_workpaper' } : {}),
      }))
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function confirmFact(fact: VatTaxFact, classification: VatFactClassification) {
    await confirmVatTaxFact(fact.id, {
      ...classification,
      direction: fact.direction,
      tax_amount_cents: fact.tax_amount_cents,
    })
  }

  async function handleConfirmFact(fact: VatTaxFact, classification: VatFactClassification) {
    try {
      setBusy(true)
      setError(null)
      await confirmFact(fact, classification)
      setRefresh((value) => value + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmAll(items: { fact: VatTaxFact; classification: VatFactClassification }[]) {
    try {
      setBusy(true)
      setError(null)
      for (const item of items) await confirmFact(item.fact, item.classification)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefresh((value) => value + 1)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth={isWorkpaper ? 'md' : 'xs'}>
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

            {isWorkpaper && preview.boxes && (
              <Box sx={{ mb: 2 }}>
                <VatBoxesTable boxes={preview.boxes} currency={currency} />
              </Box>
            )}

            {isWorkpaper && (preview.exceptions?.length ?? 0) > 0 && (
              <Alert severity={preview.exceptions?.some((item) => item.blocking) ? 'warning' : 'info'} sx={{ mb: 1 }}>
                {t($ => $.workpaper.exceptionsFound, { count: preview.exceptions?.length ?? 0 })}
              </Alert>
            )}

            {reviewFacts.length > 0 && (
              <VatTaxFactReviewList
                facts={reviewFacts}
                busy={busy}
                onConfirm={handleConfirmFact}
                onConfirmAll={handleConfirmAll}
              />
            )}

            {preview.warning_code && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {t($ => $.workpaper.genericWarning)}
              </Alert>
            )}

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
                {isWorkpaper
                  ? t($ => $.workpaper.prepareWarning)
                  : t($ => $.newDialog.filingWarning, { date: formatShortDate(preview.period_to, locale) })}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button data-testid="settle-vat-quarter" variant="contained" disabled={!canFile} onClick={handleFile}>
          {isWorkpaper ? t($ => $.actions.prepareWorkpaper) : t($ => $.actions.settleQuarter)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
