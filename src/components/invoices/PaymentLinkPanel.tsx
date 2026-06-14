import { useState } from 'react'
import type { Invoice, Id } from '../../types/entities.ts'
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

const MOLLIE_STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  open: 'default',
  paid: 'success',
  expired: 'warning',
  canceled: 'error',
}

const CREATE_ERROR_MESSAGES: Record<string, string> = {
  mollie_key_missing: 'Mollie API key not configured. Go to Settings → Integrations.',
  zero_amount: 'Invoice total must be greater than zero.',
  void_invoice: 'Cannot create a payment link for a void invoice.',
}

const REMOVE_ERROR_MESSAGES: Record<string, string> = {
  payment_link_paid: 'This payment link has already been paid — the invoice is now marked paid.',
  mollie_error: 'Mollie could not remove the link. Try again later.',
}

interface PaymentLinkPanelProps {
  invoice: Invoice
  onUpdated: (patch: Partial<Invoice>) => void
}

export default function PaymentLinkPanel({ invoice, onUpdated }: PaymentLinkPanelProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const hasLink = Boolean(invoice.mollie_payment_link_id)
  const url = invoice.mollie_payment_link_url
  const paymentStatus = invoice.mollie_payment_status
  const isVoid = invoice.status === 'void'
  const hasAmount = (invoice.total_cents ?? 0) > 0

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const result = await createInvoicePaymentLink(invoice.id!)
      // PaymentLinkResult has payment_link_id / payment_link_url — map to Invoice fields
      const patch: Partial<Invoice> = {
        mollie_payment_link_id: (result as Record<string, unknown>).payment_link_id as string | undefined,
        mollie_payment_link_url: (result as Record<string, unknown>).payment_link_url as string | undefined,
      }
      onUpdated(patch)
    } catch (err) {
      const e = err as Record<string, unknown>
      setError(CREATE_ERROR_MESSAGES[e.message as string] ?? String(e.message))
    } finally {
      setBusy(false)
    }
  }

  async function handleSync() {
    setBusy(true)
    setError(null)
    try {
      // The real sync response shape from the backend: { status, invoiceStatus, paymentId, paidAt, ... }
      // The API is typed as Invoice for convenience but has these extra runtime fields.
      const result = await syncInvoicePaymentLink(invoice.id!) as Record<string, unknown>
      onUpdated({
        mollie_payment_status: result.status as string | undefined,
        status: (result.invoiceStatus as string | undefined) ?? (result.status as string | undefined),
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
      // API typed as void but real backend returns updated invoice fields; cast to pass through.
      const result = await deleteInvoicePaymentLink(invoice.id!) as unknown
      onUpdated((result as Partial<Invoice>) ?? { mollie_payment_link_id: undefined, mollie_payment_link_url: undefined })
    } catch (err) {
      const e = err as Record<string, unknown>
      setError(REMOVE_ERROR_MESSAGES[e.code as string] ?? REMOVE_ERROR_MESSAGES[e.message as string] ?? String(e.message))
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
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Payment link</Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      {!hasLink ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleCreate}
            disabled={busy || isVoid || !hasAmount}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
          >
            Create payment link
          </Button>
          {(isVoid || !hasAmount) && (
            <Typography variant="caption" color="text.secondary">
              {isVoid ? 'Invoice is void.' : 'Invoice total must be > 0.'}
            </Typography>
          )}
        </Stack>
      ) : (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={paymentStatus || 'open'}
              color={MOLLIE_STATUS_COLOR[paymentStatus ?? ''] ?? 'default'}
            />
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1, minWidth: 0 }}
            >
              {url}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Tooltip title={copied === 'url' ? 'Copied!' : 'Copy link'}>
              <Button
                size="small"
                variant="outlined"
                startIcon={copied === 'url' ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                onClick={copyUrl}
              >
                Copy link
              </Button>
            </Tooltip>

            <Tooltip title="Open payment page">
              <Button
                size="small"
                variant="outlined"
                component="a"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<LaunchIcon fontSize="small" />}
              >
                Open
              </Button>
            </Tooltip>

            <Tooltip title="Refresh payment status from Mollie">
              <IconButton size="small" onClick={handleSync} disabled={busy} aria-label="Refresh payment status">
                {busy ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            {paymentStatus !== 'paid' && (
              <Tooltip title="Remove payment link">
                <IconButton size="small" color="error" onClick={handleRemove} disabled={busy} aria-label="Remove payment link">
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
