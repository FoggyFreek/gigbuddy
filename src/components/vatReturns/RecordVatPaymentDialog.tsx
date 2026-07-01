import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DateEntryField from '../DateEntryField.tsx'
import { listAccounts, getAccountingSettings } from '../../api/accounts.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { quarterKey, outstandingCents } from '../../utils/vatReturns.ts'
import type { VatReturn, Account } from '../../types/entities.ts'

interface PaymentBody {
  amount_cents: number
  paid_on: string
  direction: 'payment' | 'refund'
  bank_account_code: string
}

interface RecordVatPaymentDialogProps {
  vatReturn: VatReturn
  onSubmit: (body: PaymentBody) => Promise<void>
  onClose: () => void
}

// Records a (partial) payment to — or refund from — the tax authority against
// a filed declaration. The bank account picker lists the tenant's active asset
// accounts and defaults to the primary checking account from settings.
export default function RecordVatPaymentDialog({ vatReturn, onSubmit, onClose }: Readonly<RecordVatPaymentDialogProps>) {
  const { t } = useTranslation(['vatReturns', 'common'])
  const isRefund = vatReturn.direction === 'receivable'
  const outstanding = outstandingCents(vatReturn)
  const period = t($ => $.quarters[quarterKey(vatReturn.quarter ?? 1)], { year: vatReturn.year ?? 0 })
  const [amount, setAmount] = useState(() => (outstanding / 100).toFixed(2))
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [bankCode, setBankCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([listAccounts(), getAccountingSettings()])
      .then(([accs, settings]) => {
        if (!active) return
        const assets = accs.filter((a) => a.type === 'asset' && a.is_active)
        setAccounts(assets)
        const preferred = settings?.primary_checking_account_code
        if (preferred && assets.some((a) => a.code === preferred)) setBankCode(preferred)
        else if (assets.length) setBankCode(assets[0].code ?? '')
      })
      .catch((e: Error) => active && setError(e.message))
    return () => { active = false }
  }, [])

  const amountCents = Math.round(Number(amount) * 100)
  const canSubmit =
    Number.isInteger(amountCents) && amountCents > 0 && amountCents <= outstanding &&
    Boolean(paidOn) && Boolean(bankCode) && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    try {
      setBusy(true)
      setError(null)
      await onSubmit({
        amount_cents: amountCents,
        paid_on: paidOn,
        direction: isRefund ? 'refund' : 'payment',
        bank_account_code: bankCode,
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {isRefund
          ? t($ => $.paymentDialog.recordRefundTitle, { period })
          : t($ => $.paymentDialog.recordPaymentTitle, { period })}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {accounts === null && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {accounts && (
          <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 2 }}>
              <Typography variant="subtitle2">{t($ => $.fields.outstanding)}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatEur(outstanding)}</Typography>
            </Box>
            <TextField
              label={t($ => $.fields.amount)}
              size="small"
              fullWidth
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
              sx={{ mb: 2 }}
            />
            <Box sx={{ mb: 2 }}>
              <DateEntryField
                label={isRefund ? t($ => $.fields.receivedOn) : t($ => $.fields.paidOn)}
                size="small"
                fullWidth
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                sx={undefined}
              />
            </Box>
            <TextField
              data-testid="vat-bank-account"
              label={isRefund ? t($ => $.fields.toAccount) : t($ => $.fields.fromAccount)}
              size="small"
              fullWidth
              select
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
            >
              {accounts.map((a) => (
                <MenuItem key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button data-testid="submit-vat-settlement" variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
          {isRefund ? t($ => $.actions.recordRefund) : t($ => $.actions.recordPayment)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
