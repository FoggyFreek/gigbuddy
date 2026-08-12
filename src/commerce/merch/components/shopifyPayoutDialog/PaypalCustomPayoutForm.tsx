import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { Account, PaypalOrderMatch } from '../../../../types/entities.ts'
import { formatShortDate } from '../../../../utils/dateFormat.ts'
import { formatCurrency } from '../../../../finance/invoices/invoiceTotals.ts'
import DateEntryField from '../../../../components/DateEntryField.tsx'
import MoneyInput from '../../../../finance/invoices/components/MoneyInput.tsx'

interface Props {
  candidates: PaypalOrderMatch[]
  selectedCandidates: PaypalOrderMatch[]
  selected: Set<string>
  accounts: Account[]
  reference: string
  date: string
  depositCents: number
  grossCents: number
  differenceAccountCode: string
  creating: boolean
  onReferenceChange: (reference: string) => void
  onDateChange: (date: string) => void
  onDepositChange: (depositCents: number) => void
  onDifferenceAccountChange: (accountCode: string) => void
  onCandidateToggle: (candidate: PaypalOrderMatch) => void
  onRecord: () => void
  onCancel: () => void
}

export function PaypalCustomPayoutForm({
  candidates,
  selectedCandidates,
  selected,
  accounts,
  reference,
  date,
  depositCents,
  grossCents,
  differenceAccountCode,
  creating,
  onReferenceChange,
  onDateChange,
  onDepositChange,
  onDifferenceAccountChange,
  onCandidateToggle,
  onRecord,
  onCancel,
}: Readonly<Props>) {
  const { t } = useTranslation('merch')
  const currency = selectedCandidates[0]?.currency ?? 'EUR'
  const differenceCents = grossCents - depositCents
  const selectedCurrency = selectedCandidates[0]?.currency
  const incomplete = creating || !reference.trim() || !date || depositCents <= 0
    || selectedCandidates.length === 0 || (differenceCents !== 0 && !differenceAccountCode)

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.shopifyPayout.paypal.title)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.shopifyPayout.paypal.intro)}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label={t($ => $.shopifyPayout.customReference)}
          value={reference}
          onChange={(event) => onReferenceChange(event.target.value)}
          fullWidth
        />
        <DateEntryField
          id="paypal-custom-payout-date"
          label={t($ => $.shopifyPayout.paymentDate)}
          value={date}
          sx={{ minWidth: 160 }}
          onChange={(event) => onDateChange(event.target.value)}
          size="small"
        />
        <MoneyInput
          cents={depositCents}
          onChange={onDepositChange}
          label={t($ => $.shopifyPayout.paypal.deposit)}
          currency={currency}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {t($ => $.shopifyPayout.paypal.orders)}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
        {candidates.map((candidate) => {
          const disabled = Boolean(selectedCurrency && candidate.currency !== selectedCurrency)
          return (
            <Box
              key={String(candidate.id)}
              component="label"
              sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
              }}
            >
              <Checkbox
                size="small"
                checked={selected.has(String(candidate.id))}
                disabled={disabled}
                onChange={() => onCandidateToggle(candidate)}
              />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2">{candidate.order_name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatShortDate(candidate.processed_at)}
                </Typography>
              </Box>
              <Typography variant="body2">
                {formatCurrency(candidate.gross_cents, candidate.currency)}
              </Typography>
            </Box>
          )
        })}
      </Stack>
      {selectedCandidates.length > 0 && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {t($ => $.shopifyPayout.paypal.summary, {
            gross: formatCurrency(grossCents, currency),
            deposit: formatCurrency(depositCents, currency),
            difference: formatCurrency(differenceCents, currency),
          })}
        </Alert>
      )}
      {differenceCents !== 0 && selectedCandidates.length > 0 && (
        <FormControl size="small" fullWidth sx={{ mt: 1.5 }}>
          <InputLabel id="paypal-difference-account-label">
            {t($ => $.shopifyPayout.paypal.differenceAccount)}
          </InputLabel>
          <Select
            id="paypal-difference-account"
            labelId="paypal-difference-account-label"
            label={t($ => $.shopifyPayout.paypal.differenceAccount)}
            value={differenceAccountCode}
            onChange={(event) => onDifferenceAccountChange(event.target.value)}
          >
            {accounts.map((account) => (
              <MenuItem key={String(account.code)} value={account.code}>
                {account.code} — {account.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button variant="contained" disabled={incomplete} onClick={onRecord}>
          {t($ => $.shopifyPayout.recordPayment)}
        </Button>
        <Button disabled={creating} onClick={onCancel}>
          {t($ => $.shopifyPayout.customCancel)}
        </Button>
      </Stack>
    </Paper>
  )
}
