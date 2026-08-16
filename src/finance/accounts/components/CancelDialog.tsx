import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { formatEur } from '../../invoices/invoiceTotals.ts'
import type { Subscription } from '../../../commerce/billing/billing.ts'

interface Props {
  open: boolean
  subscription: Subscription
  refundWindowDays: number
  busy: boolean
  onClose: () => void
  onCancel: (immediate: boolean) => void
}

/**
 * Two ways out, and the customer sees both. Inside the withdrawal window
 * cancelling is immediate and refunds the charge that opened the period in
 * full; outside it the subscription runs to the period end with no refund.
 *
 * The immediate branch is offered ONLY while the server says the window is open
 * (`refundEligibleUntil`), because the server rejects it otherwise rather than
 * quietly falling back to a period-end cancel.
 */
export default function CancelDialog({
  open, subscription, refundWindowDays, busy, onClose, onCancel,
}: Readonly<Props>) {
  const { t } = useTranslation('billing')

  const refundable = subscription.refundEligibleUntil !== null
  const refundAmount = subscription.totalCents ?? 0
  const periodEnd = subscription.currentPeriodEnd

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.cancel.title)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {refundable && (
            <Alert severity="info" icon={false}>
              <Typography variant="subtitle2">{t($ => $.cancel.immediateTitle)}</Typography>
              <Typography variant="body2">
                {t($ => $.cancel.immediateBody, {
                  count: refundWindowDays, price: formatEur(refundAmount),
                })}
              </Typography>
            </Alert>
          )}

          {periodEnd !== null && (
            <Alert severity="info" icon={false}>
              <Typography variant="subtitle2">{t($ => $.cancel.periodEndTitle)}</Typography>
              <Typography variant="body2">
                {t($ => $.cancel.periodEndBody, { date: new Date(periodEnd) })}
              </Typography>
            </Alert>
          )}

          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.cancel.keepData)}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} disabled={busy}>{t($ => $.cancel.keep)}</Button>
        {refundable && (
          <Button color="error" onClick={() => onCancel(true)} disabled={busy}>
            {t($ => $.cancel.chooseImmediate)}
          </Button>
        )}
        <Button color="error" variant="contained" onClick={() => onCancel(false)} disabled={busy}>
          {t($ => $.cancel.choosePeriodEnd)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
