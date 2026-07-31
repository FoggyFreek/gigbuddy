import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import {
  acknowledgeVatException,
  getVatReturn,
  recordVatPayment,
  submitVatReturn,
} from '../api/vatReturns.ts'
import { formatCurrency } from '../utils/invoiceTotals.ts'
import { useAccountingProfile } from '../contexts/accountingProfileContext.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import { quarterKey, statusMeta, outstandingCents } from '../utils/vatReturns.ts'
import RecordVatPaymentDialog from '../components/vatReturns/RecordVatPaymentDialog.tsx'
import VatBoxesTable from '../components/vatReturns/VatBoxesTable.tsx'
import type { VatReturn, VatReturnPayment } from '../types/entities.ts'

interface VatReturnDetailOutletContext {
  insideSplitView?: boolean
  onClose?: () => void
  onChanged?: () => void
}

function Row({ label, value }: Readonly<{ label: string; value?: ReactNode }>) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  )
}

// Detail pane of one filed declaration (SplitView child of /vat-returns):
// the stored breakdown, the settlement ledger entry link, payments so far and
// the outstanding balance with a record-payment/refund action.
export default function VatReturnDetailPage() {
  const currency = useAccountingProfile().profile?.base_currency ?? 'EUR'
  const { t, i18n } = useTranslation(['vatReturns', 'common'])
  const { id } = useParams()
  const vatReturnId = Number(id)
  const navigate = useNavigate()
  const outletCtx = (useOutletContext<VatReturnDetailOutletContext>() || {}) as VatReturnDetailOutletContext
  const insideSplitView = !!outletCtx.insideSplitView

  const [ret, setRet] = useState<VatReturn & { filed_at?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [submissionReference, setSubmissionReference] = useState('')
  const [acknowledgementNote, setAcknowledgementNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    getVatReturn(vatReturnId)
      .then((r) => setRet(r as VatReturn & { filed_at?: string }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [vatReturnId])

  useEffect(() => { load() }, [load])

  function closeView() {
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate('/vat-returns')
  }

  async function handlePayment(body: Record<string, unknown>) {
    await recordVatPayment(vatReturnId, body)
    load()
    if (outletCtx.onChanged) outletCtx.onChanged()
  }

  async function handleSubmit() {
    if (!submissionReference.trim()) return
    try {
      setBusy(true)
      await submitVatReturn(vatReturnId, submissionReference.trim())
      load()
      outletCtx.onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleAcknowledge(exceptionKey: string) {
    if (!acknowledgementNote.trim()) return
    try {
      setBusy(true)
      await acknowledgeVatException(vatReturnId, exceptionKey, acknowledgementNote.trim())
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const outstanding = ret ? outstandingCents(ret) : 0
  const isRefund = ret?.direction === 'receivable'
  const direction = ret?.direction ?? 'nil'
  const dueLabel = t($ => $.direction[direction])

  function exceptionLabel(key: string) {
    switch (key) {
      case 'unconfirmed_tax_categories':
        return t($ => $.workpaper.exceptionLabels.unconfirmedTaxCategories)
      case 'unmapped_tax_amounts':
        return t($ => $.workpaper.exceptionLabels.unmappedTaxAmounts)
      case 'ledger_reconciliation_difference':
        return t($ => $.workpaper.exceptionLabels.ledgerReconciliationDifference)
      case 'prior_period_amendments':
        return t($ => $.workpaper.exceptionLabels.priorPeriodAmendments)
      default:
        return key
    }
  }
  const period = ret
    ? t($ => $.quarters[quarterKey(ret.quarter ?? 1)], { year: ret.year ?? 0 })
    : t($ => $.declaration)
  const locale = i18n.resolvedLanguage

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 600, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={closeView} aria-label={t($ => $.aria.back, { ns: 'common' })}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {period}
        </Typography>
        {ret && (
          <Chip
            size="small"
            label={ret.workflow_status === 'prepared'
              ? t($ => $.workpaper.prepared)
              : t($ => $.status[statusMeta(ret).statusKey])}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        {ret && ret.workflow_status !== 'prepared' && ret.direction !== 'nil' && outstanding > 0 && (
          <Button data-testid="record-vat-settlement" variant="contained" onClick={() => setPaying(true)}>
            {isRefund ? t($ => $.actions.recordRefund) : t($ => $.actions.recordPayment)}
          </Button>
        )}
        {insideSplitView && (
          <IconButton onClick={closeView} aria-label={t($ => $.aria.close, { ns: 'common' })}>
            <CloseIcon />
          </IconButton>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!ret && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {ret && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Row label={t($ => $.fields.period)} value={`${formatShortDate(ret.period_from, locale)} – ${formatShortDate(ret.period_to, locale)}`} />
          <Row label={t($ => $.fields.dueDate)} value={formatShortDate(ret.due_date, locale)} />
          <Row label={t($ => $.fields.filed)} value={formatShortDate(ret.filed_at, locale)} />
          {ret.schema_version && (
            <Row label={t($ => $.workpaper.boxesTitle)} value={t($ => $.workpaper.schema, { version: ret.schema_version })} />
          )}
          <Divider sx={{ my: 1 }} />
          <Row label={t($ => $.fields.outputVat)} value={formatCurrency(ret.output_vat_cents, currency)} />
          <Row label={t($ => $.fields.inputVat)} value={`− ${formatCurrency(ret.input_vat_cents, currency)}`} />
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
            <Typography variant="subtitle2">
              {dueLabel}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatCurrency(Math.abs(ret.net_cents ?? 0), currency)}</Typography>
          </Box>

          {ret.calculation_mode === 'category_workpaper' && ret.boxes && (
            <>
              <Divider sx={{ my: 1 }} />
              <VatBoxesTable boxes={ret.boxes} currency={currency} />
            </>
          )}

          {ret.workflow_status === 'prepared' && (
            <>
              {(ret.exceptions_snapshot?.length ?? 0) > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t($ => $.workpaper.exceptionsTitle)}</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    label={t($ => $.workpaper.acknowledgementNote)}
                    value={acknowledgementNote}
                    onChange={(event) => setAcknowledgementNote(event.target.value)}
                    sx={{ mb: 1 }}
                  />
                  {ret.exceptions_snapshot?.map((exception) => {
                    const done = ret.acknowledgements?.some((ack) => ack.exception_key === exception.key)
                    return (
                      <Box key={exception.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="body2" sx={{ flexGrow: 1 }}>
                          {exceptionLabel(exception.key)} {exception.count ? `(${exception.count})` : ''}
                        </Typography>
                        <Button
                          size="small"
                          disabled={busy || done || !acknowledgementNote.trim()}
                          onClick={() => handleAcknowledge(exception.key)}
                        >
                          {done ? '✓' : t($ => $.actions.acknowledge)}
                        </Button>
                      </Box>
                    )
                  })}
                </Box>
              )}
              <TextField
                size="small"
                fullWidth
                label={t($ => $.workpaper.submissionReference)}
                helperText={t($ => $.workpaper.submissionHelp)}
                value={submissionReference}
                onChange={(event) => setSubmissionReference(event.target.value)}
                sx={{ mt: 2 }}
              />
              <Button
                variant="contained"
                disabled={busy || !submissionReference.trim()}
                onClick={handleSubmit}
                sx={{ mt: 1 }}
              >
                {t($ => $.actions.submitReturn)}
              </Button>
            </>
          )}

          {ret.payments && ret.payments.length > 0 && (
            <>
              <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
                {isRefund ? t($ => $.paymentHistory.refundsReceived) : t($ => $.paymentHistory.payments)}
              </Typography>
              {ret.payments.map((p: VatReturnPayment) => (
                <Row
                  key={String(p.id)}
                  label={`${formatShortDate(p.paid_on, locale)} · ${p.bank_account_code}`}
                  value={formatCurrency(p.amount_cents, currency)}
                />
              ))}
              {ret.direction !== 'nil' && (
                <Row label={t($ => $.fields.outstanding)} value={formatCurrency(outstanding, currency)} />
              )}
              <Divider sx={{ my: 1 }} />
            </>
          )}

          {ret.notes && (
            <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
              {ret.notes}
            </Typography>
          )}

          {ret.ledger_transaction_id != null && (
            <Link data-testid="vat-ledger-entry-link" component={RouterLink} to={`/ledger/${ret.ledger_transaction_id}`} variant="body2">
              {t($ => $.actions.viewLedgerEntry)}
            </Link>
          )}
        </Paper>
      )}

      {paying && ret && (
        <RecordVatPaymentDialog
          vatReturn={ret}
          onSubmit={handlePayment as unknown as Parameters<typeof RecordVatPaymentDialog>[0]['onSubmit']}
          onClose={() => setPaying(false)}
        />
      )}
    </Box>
  )
}
