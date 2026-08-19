import Alert from '@mui/material/Alert'
import FormControlLabel from '@mui/material/FormControlLabel'
import Grid from '@mui/material/Grid'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import PercentSplitField from './PercentSplitField.tsx'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'
import {
  DEAL_TYPES,
  dealTypeChoosesVenueCosts,
  dealTypeHasGuaranteedFee,
  dealTypeHasTicketShare,
} from '../../../dealTerms.ts'
import type { DealType } from '../../../dealTerms.ts'
import type { GigDetailForm } from '../types.ts'

interface Props {
  editable: boolean
  form: GigDetailForm
  onChange: (field: string, value: unknown) => void
}

export default function DealSection({ editable, form, onChange }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const dealType = form.deal_type as DealType
  const hasFee = dealTypeHasGuaranteedFee(dealType)
  const hasShare = dealTypeHasTicketShare(dealType)

  // Both the fee and the share sit on the deal row, so the row's columns depend
  // on how many of the two this deal type actually uses.
  const columnsInUse = 1 + (hasFee ? 1 : 0) + (hasShare ? 1 : 0)
  const dealColumn = { xs: 12, md: 12 / columnsInUse }

  const moneyProps = {
    htmlInput: { min: 0, step: 0.01, readOnly: !editable },
    input: { startAdornment: <InputAdornment position="start">€</InputAdornment> },
  }
  const countProps = { htmlInput: { min: 0, step: 1, readOnly: !editable } }

  return (
    <>
      <Grid size={12}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {t($ => $.detail.deal.title)}
        </Typography>
      </Grid>

      <Grid size={dealColumn}>
        <TextField
          select
          label={t($ => $.detail.deal.dealType)}
          fullWidth
          value={dealType}
          disabled={!editable}
          onChange={(event) => onChange('deal_type', event.target.value)}
        >
          {DEAL_TYPES.map((type) => (
            <MenuItem key={type} value={type}>{t($ => $.detail.deal.dealTypes[type])}</MenuItem>
          ))}
        </TextField>
      </Grid>

      {hasFee && (
        <Grid size={dealColumn}>
          <TextField
            label={t($ => $.detail.deal.guaranteedFee)}
            type="number"
            fullWidth
            value={form.guaranteed_fee}
            onChange={(event) => onChange('guaranteed_fee', event.target.value)}
            placeholder="0.00"
            sx={NO_NUMBER_SPINNER_SX}
            slotProps={moneyProps}
          />
        </Grid>
      )}

      {hasShare && (
        <Grid size={dealColumn}>
          <PercentSplitField
            artistLabel={dealType === 'guarantee_vs'
              ? t($ => $.detail.deal.ticketPercentage)
              : t($ => $.detail.deal.percentAfterBreakEven)}
            venueLabel={t($ => $.detail.deal.venueShare)}
            value={form.percentage_of_sales as string}
            disabled={!editable}
            onChange={(next) => onChange('percentage_of_sales', next)}
          />
        </Grid>
      )}

      <Grid size={12}>
        <Alert severity="info" variant="outlined" icon={false} sx={{ py: 0.5 }}>
          <Typography variant="body2">{t($ => $.detail.deal.dealTypeHelp[dealType])}</Typography>
        </Alert>
      </Grid>

      {dealTypeChoosesVenueCosts(dealType) && (
        <Grid size={12}>
          <FormControlLabel
            control={
              <Switch
                checked={form.breakeven_includes_venue_costs as boolean}
                disabled={!editable}
                onChange={(event) => onChange('breakeven_includes_venue_costs', event.target.checked)}
              />
            }
            label={t($ => $.detail.deal.includeVenueCosts)}
          />
        </Grid>
      )}

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <TextField
          label={t($ => $.detail.deal.venueCosts)}
          type="number"
          fullWidth
          value={form.venue_costs}
          onChange={(event) => onChange('venue_costs', event.target.value)}
          placeholder="0.00"
          helperText={t($ => $.detail.deal.venueCostsHelp)}
          sx={NO_NUMBER_SPINNER_SX}
          slotProps={moneyProps}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <TextField
          label={t($ => $.detail.deal.venueCapacity)}
          type="number"
          fullWidth
          value={form.venue_capacity}
          onChange={(event) => onChange('venue_capacity', event.target.value)}
          placeholder="0"
          sx={NO_NUMBER_SPINNER_SX}
          slotProps={countProps}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <TextField
          label={t($ => $.detail.deal.expectedVisitors)}
          type="number"
          fullWidth
          value={form.expected_visitors}
          onChange={(event) => onChange('expected_visitors', event.target.value)}
          placeholder="0"
          helperText={t($ => $.detail.deal.expectedVisitorsHelp)}
          sx={NO_NUMBER_SPINNER_SX}
          slotProps={countProps}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <TextField
          label={t($ => $.detail.deal.netTicketPrice)}
          type="number"
          fullWidth
          value={form.ticket_price_net}
          onChange={(event) => onChange('ticket_price_net', event.target.value)}
          placeholder="0.00"
          helperText={t($ => $.detail.deal.netTicketPriceHelp)}
          sx={NO_NUMBER_SPINNER_SX}
          slotProps={moneyProps}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <TextField
          label={t($ => $.detail.deal.grossTicketPrice)}
          type="number"
          fullWidth
          value={form.ticket_price_gross}
          onChange={(event) => onChange('ticket_price_gross', event.target.value)}
          placeholder="0.00"
          sx={NO_NUMBER_SPINNER_SX}
          slotProps={moneyProps}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <TextField
          label={t($ => $.detail.deal.ticketsSold)}
          type="number"
          fullWidth
          value={form.tickets_sold}
          onChange={(event) => onChange('tickets_sold', event.target.value)}
          placeholder="0"
          sx={NO_NUMBER_SPINNER_SX}
          slotProps={countProps}
        />
      </Grid>
    </>
  )
}
