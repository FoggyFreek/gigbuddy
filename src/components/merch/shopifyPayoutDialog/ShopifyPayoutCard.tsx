import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { Account, ShopifyManualPayout } from '../../../types/entities.ts'
import { formatShortDate } from '../../../utils/dateFormat.ts'
import { formatCurrency } from '../../../utils/invoiceTotals.ts'
import DateEntryField from '../../DateEntryField.tsx'
import type { ShopifyPayoutMappings } from '../useShopifyPayoutDialog.ts'

interface Props {
  payout: ShopifyManualPayout
  accounts: Account[]
  entryDate: string
  mappings: ShopifyPayoutMappings
  complete: boolean
  settling: boolean
  onEntryDateChange: (date: string) => void
  onAdjustmentAccountChange: (adjustmentId: ShopifyManualPayout['adjustments'][number]['id'], accountCode: string) => void
  onSettle: () => void
}

export function ShopifyPayoutCard({
  payout,
  accounts,
  entryDate,
  mappings,
  complete,
  settling,
  onEntryDateChange,
  onAdjustmentAccountChange,
  onSettle,
}: Readonly<Props>) {
  const { t } = useTranslation('merch')

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Box>
          <Typography sx={{ fontWeight: 600 }}>
            {t($ => $.shopifyPayout.payoutLabel, { id: payout.shopify_payout_id })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatShortDate(payout.issued_at)} · {payout.transaction_type}
          </Typography>
        </Box>
        <Typography sx={{ fontWeight: 600 }}>
          {formatCurrency(payout.net_cents, payout.currency)}
        </Typography>
      </Box>

      {payout.orders.map((order) => (
        <Box key={String(order.id)} sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="body2">{order.order_name}</Typography>
          <Typography variant="body2">{formatCurrency(order.net_cents, payout.currency)}</Typography>
        </Box>
      ))}

      {payout.adjustments.length > 0 && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t($ => $.shopifyPayout.adjustmentsIntro)}
          </Typography>
          {payout.adjustments.map((adjustment) => (
            <FormControl size="small" key={String(adjustment.id)} fullWidth>
              <InputLabel>{adjustment.type}</InputLabel>
              <Select
                label={adjustment.type}
                value={mappings[String(payout.id)]?.[String(adjustment.id)] ?? ''}
                onChange={(event) => onAdjustmentAccountChange(adjustment.id, event.target.value)}
              >
                {accounts.map((account) => (
                  <MenuItem key={String(account.code)} value={account.code}>
                    {account.code} — {account.name} ({formatCurrency(adjustment.net_cents, payout.currency)})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ))}
        </Stack>
      )}

      {!payout.ready && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>{t($ => $.shopifyPayout.incomplete)}</Alert>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2, alignItems: { sm: 'center' } }}>
        <DateEntryField
          id={`shopify-payout-date-${payout.id}`}
          label={t($ => $.shopifyPayout.paymentDate)}
          value={entryDate}
          onChange={(event) => onEntryDateChange(event.target.value)}
          size="small"
        />
        <Button variant="contained" disabled={!complete || settling} onClick={onSettle}>
          {payout.transaction_type === 'DEPOSIT'
            ? t($ => $.shopifyPayout.recordDeposit)
            : t($ => $.shopifyPayout.recordWithdrawal)}
        </Button>
      </Stack>
    </Paper>
  )
}
