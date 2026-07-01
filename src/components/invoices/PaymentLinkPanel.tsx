import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Invoice } from '../../types/entities.ts'
import { useThemeMode } from '../../contexts/themeModeContext.ts'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import LaunchIcon from '@mui/icons-material/Launch'
import RefreshIcon from '@mui/icons-material/Refresh'
import { createInvoicePaymentLink, syncInvoicePaymentLink, deleteInvoicePaymentLink } from '../../api/invoices.ts'

const MOLLIE_STATUS_COLOR = {
  open: 'default',
  paid: 'success',
  expired: 'warning',
  canceled: 'error',
} as const

const CREATE_ERROR_KEYS = {
  mollie_key_missing: 'mollieKeyMissing',
  zero_amount: 'zeroAmount',
  void_invoice: 'voidInvoice',
} as const

const REMOVE_ERROR_KEYS = {
  payment_link_paid: 'alreadyPaid',
  mollie_error: 'removeFailed',
} as const

type PaymentStatus = keyof typeof MOLLIE_STATUS_COLOR

function isPaymentStatus(status: string | undefined): status is PaymentStatus {
  return Boolean(status && Object.hasOwn(MOLLIE_STATUS_COLOR, status))
}

interface PaymentLinkPanelProps {
  invoice: Invoice
  onUpdated: (patch: Partial<Invoice>) => void
}

export default function PaymentLinkPanel({ invoice, onUpdated }: Readonly<PaymentLinkPanelProps>) {
  const { t } = useTranslation('invoices')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const { mode } = useThemeMode()

  const hasLink = Boolean(invoice.mollie_payment_link_id)
  const url = invoice.mollie_payment_link_url
  const paymentStatus = invoice.mollie_payment_status
  const isVoid = invoice.status === 'void'
  const isSaved = Boolean(invoice.id)
  const hasAmount = (invoice.total_cents ?? 0) > 0

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const result = await createInvoicePaymentLink(invoice.id!)
      onUpdated(result)
    } catch (err) {
      const e = err as Record<string, unknown>
      const errorKey = CREATE_ERROR_KEYS[e.message as keyof typeof CREATE_ERROR_KEYS]
      setError(errorKey ? t($ => $.paymentLink.errors[errorKey]) : String(e.message))
    } finally {
      setBusy(false)
    }
  }

  async function handleSync() {
    setBusy(true)
    setError(null)
    try {
      const result = await syncInvoicePaymentLink(invoice.id!)
      onUpdated({
        mollie_payment_status: result.status ?? undefined,
        status: result.invoiceStatus,
      })
    } catch (err) {
      const e = err as Error
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    setError(null)
    try {
      const result = await deleteInvoicePaymentLink(invoice.id!)
      onUpdated(result)
    } catch (err) {
      const e = err as Record<string, unknown>
      const code = (e.code ?? e.message) as keyof typeof REMOVE_ERROR_KEYS
      const errorKey = REMOVE_ERROR_KEYS[code]
      setError(errorKey ? t($ => $.paymentLink.errors[errorKey]) : String(e.message))
    } finally {
      setBusy(false)
    }
  }

  function clearCopiedFlag() {
    setCopied((c) => (c === 'url' ? null : c))
  }

  function copyUrl() {
    if (!url) return
    navigator.clipboard.writeText(url).then(() => {
      setCopied('url')
      setTimeout(clearCopiedFlag, 1500)
    }).catch(() => {})
  }

  return (
    <Box>
      <Box
        component="img"
        src={mode === 'dark' ? '/share/mollie/Mollie-Logo-White-2023.png' : '/share/mollie/Mollie-Logo-Black-2023.png'}
        alt="Mollie"
        sx={{ height: 20, display: 'block', mb: 1 }}
      />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{t($ => $.paymentLink.title)}</Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      {!hasLink ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleCreate}
            disabled={busy || isVoid || !isSaved || !hasAmount}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
          >
            {t($ => $.paymentLink.create)}
          </Button>
          {(isVoid || !isSaved || !hasAmount) && (
            <Typography variant="caption" color="text.secondary">
              {isVoid
                ? t($ => $.paymentLink.invoiceVoid)
                : !isSaved
                  ? t($ => $.paymentLink.notSaved)
                  : t($ => $.paymentLink.amountRequired)}
            </Typography>
          )}
        </Stack>
      ) : (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={paymentStatus === 'paid'
                ? t($ => $.rawStatus.paid)
                : isPaymentStatus(paymentStatus)
                  ? t($ => $.paymentLink.status[paymentStatus as Exclude<PaymentStatus, 'paid'>])
                  : (paymentStatus || t($ => $.paymentLink.status.open))}
              color={isPaymentStatus(paymentStatus) ? MOLLIE_STATUS_COLOR[paymentStatus] : 'default'}
            />
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1, minWidth: 0 }}
            >
              {url}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Tooltip title={copied === 'url' ? t($ => $.paymentLink.copied) : t($ => $.paymentLink.copy)}>
              <Button
                size="small"
                variant="outlined"
                startIcon={copied === 'url' ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                onClick={copyUrl}
              >
                {t($ => $.paymentLink.copy)}
              </Button>
            </Tooltip>

            <Tooltip title={t($ => $.paymentLink.openTooltip)}>
              <Button
                size="small"
                variant="outlined"
                component="a"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<LaunchIcon fontSize="small" />}
              >
                {t($ => $.paymentLink.open)}
              </Button>
            </Tooltip>

            <Tooltip title={t($ => $.paymentLink.refresh)}>
              <IconButton size="small" onClick={handleSync} disabled={busy} aria-label={t($ => $.paymentLink.refreshAria)}>
                {busy ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            {paymentStatus !== 'paid' && (
              <Tooltip title={t($ => $.paymentLink.remove)}>
                <IconButton size="small" color="error" onClick={handleRemove} disabled={busy} aria-label={t($ => $.paymentLink.remove)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>
      )}
    </Box>
  )
}
