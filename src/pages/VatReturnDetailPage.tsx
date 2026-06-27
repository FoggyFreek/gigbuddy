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
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import { getVatReturn, recordVatPayment } from '../api/vatReturns.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import { quarterKey, statusMeta, outstandingCents } from '../utils/vatReturns.ts'
import RecordVatPaymentDialog from '../components/vatReturns/RecordVatPaymentDialog.tsx'
import type { VatReturn, VatReturnPayment } from '../types/entities.ts'

interface VatReturnDetailOutletContext {
  insideSplitView?: boolean
  onClose?: () => void
  onChanged?: () => void
}

function Row({ label, value }: { label: string; value?: ReactNode }) {
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
  const { t, i18n } = useTranslation('vatReturns')
  const { id } = useParams()
  const vatReturnId = Number(id)
  const navigate = useNavigate()
  const outletCtx = (useOutletContext<VatReturnDetailOutletContext>() || {}) as VatReturnDetailOutletContext
  const insideSplitView = !!outletCtx.insideSplitView

  const [ret, setRet] = useState<VatReturn & { filed_at?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)

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

  const outstanding = ret ? outstandingCents(ret) : 0
  const isRefund = ret?.direction === 'receivable'
  const direction = ret?.direction ?? 'nil'
  const dueLabel = t($ => $.direction[direction])
  const period = ret
    ? t($ => $.quarters[quarterKey(ret.quarter ?? 1)], { year: ret.year ?? 0 })
    : t($ => $.declaration)
  const locale = i18n.resolvedLanguage

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 600, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={closeView} aria-label={t($ => $.aria.back)}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {period}
        </Typography>
        {ret && <Chip size="small" label={t($ => $.status[statusMeta(ret).statusKey])} />}
        <Box sx={{ flexGrow: 1 }} />
        {ret && ret.direction !== 'nil' && outstanding > 0 && (
          <Button data-testid="record-vat-settlement" variant="contained" onClick={() => setPaying(true)}>
            {isRefund ? t($ => $.actions.recordRefund) : t($ => $.actions.recordPayment)}
          </Button>
        )}
        {insideSplitView && (
          <IconButton onClick={closeView} aria-label={t($ => $.aria.close)}>
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
          <Divider sx={{ my: 1 }} />
          <Row label={t($ => $.fields.outputVat)} value={formatEur(ret.output_vat_cents)} />
          <Row label={t($ => $.fields.inputVat)} value={`− ${formatEur(ret.input_vat_cents)}`} />
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
            <Typography variant="subtitle2">
              {dueLabel}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatEur(Math.abs(ret.net_cents ?? 0))}</Typography>
          </Box>

          {ret.payments && ret.payments.length > 0 && (
            <>
              <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
                {isRefund ? t($ => $.paymentHistory.refundsReceived) : t($ => $.paymentHistory.payments)}
              </Typography>
              {ret.payments.map((p: VatReturnPayment) => (
                <Row
                  key={String(p.id)}
                  label={`${formatShortDate(p.paid_on, locale)} · ${p.bank_account_code}`}
                  value={formatEur(p.amount_cents)}
                />
              ))}
              {ret.direction !== 'nil' && (
                <Row label={t($ => $.fields.outstanding)} value={formatEur(outstanding)} />
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
