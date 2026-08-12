import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { ShopifyCustomPayoutCandidate } from '../../../../types/entities.ts'
import { formatShortDate } from '../../../../utils/dateFormat.ts'
import { formatCurrency } from '../../../../finance/invoices/invoiceTotals.ts'
import DateEntryField from '../../../../components/DateEntryField.tsx'
import MoneyInput from '../../../../finance/invoices/components/MoneyInput.tsx'
import { customCandidateKey } from '../useShopifyPayoutDialog.ts'

interface Props {
  candidates: ShopifyCustomPayoutCandidate[]
  selectedCandidates: ShopifyCustomPayoutCandidate[]
  selected: Set<string>
  reference: string
  date: string
  netCents: number
  expectedNetCents: number
  creating: boolean
  onReferenceChange: (reference: string) => void
  onDateChange: (date: string) => void
  onNetCentsChange: (netCents: number) => void
  onCandidateToggle: (candidate: ShopifyCustomPayoutCandidate) => void
  onCreate: () => void
  onCancel: () => void
}

export function ShopifyCustomPayoutForm({
  candidates,
  selectedCandidates,
  selected,
  reference,
  date,
  netCents,
  expectedNetCents,
  creating,
  onReferenceChange,
  onDateChange,
  onNetCentsChange,
  onCandidateToggle,
  onCreate,
  onCancel,
}: Readonly<Props>) {
  const { t } = useTranslation('merch')
  const currency = selectedCandidates[0]?.currency ?? 'EUR'

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.shopifyPayout.createCustom)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.shopifyPayout.customIntro)}
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
          id="shopify-custom-payout-date"
          label={t($ => $.shopifyPayout.customDate)}
          value={date}
          sx={{ minWidth: 160 }}
          onChange={(event) => onDateChange(event.target.value)}
          size="small"
        />
        <MoneyInput
          cents={netCents}
          onChange={onNetCentsChange}
          label={t($ => $.shopifyPayout.customAmount)}
          currency={currency}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {t($ => $.shopifyPayout.customOrders)}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
        {candidates.map((candidate) => (
          <Box
            key={customCandidateKey(candidate)}
            component="label"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
          >
            <Checkbox
              size="small"
              checked={selected.has(customCandidateKey(candidate))}
              onChange={() => onCandidateToggle(candidate)}
            />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2">{candidate.order_name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {formatShortDate(candidate.processed_at)}
                {candidate.source_payout_id
                  ? ` · ${t($ => $.shopifyPayout.customSourcePayout, { id: candidate.source_payout_id })}`
                  : ''}
              </Typography>
            </Box>
            <Typography variant="body2">
              {formatCurrency(candidate.net_cents, candidate.currency)}
            </Typography>
          </Box>
        ))}
      </Stack>
      {netCents !== expectedNetCents && selectedCandidates.length > 0 && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {t($ => $.shopifyPayout.customDifference, {
            amount: formatCurrency(netCents - expectedNetCents, currency),
          })}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button
          variant="contained"
          disabled={creating || !reference.trim() || !date
            || netCents <= 0 || selectedCandidates.length === 0}
          onClick={onCreate}
        >
          {t($ => $.shopifyPayout.customSubmit)}
        </Button>
        <Button disabled={creating} onClick={onCancel}>
          {t($ => $.shopifyPayout.customCancel)}
        </Button>
      </Stack>
    </Paper>
  )
}
