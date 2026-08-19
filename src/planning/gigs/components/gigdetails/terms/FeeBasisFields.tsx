import Grid from '@mui/material/Grid'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { useTranslation } from 'react-i18next'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'
import { FEE_BASES } from '../../../dealTerms.ts'
import type { FeeBasis } from '../../../dealTerms.ts'

interface Props {
  basisLabel: string
  basis: FeeBasis
  percentage: string
  amount: string
  /** What the percentage is taken from, shown under the percentage input. */
  percentageHelp: string
  editable: boolean
  onChange: (field: 'basis' | 'percentage' | 'amount', value: string) => void
}

// The booking fee and the commission are both "a percentage of something, or a
// fixed amount" — one shape, used twice, with the basis as the discriminator so
// neither number has to stand in for "not set".
export default function FeeBasisFields({
  basisLabel,
  basis,
  percentage,
  amount,
  percentageHelp,
  editable,
  onChange,
}: Readonly<Props>) {
  const { t } = useTranslation('gigs')

  return (
    <>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          select
          label={basisLabel}
          fullWidth
          value={basis}
          disabled={!editable}
          onChange={(event) => onChange('basis', event.target.value)}
        >
          {FEE_BASES.map((option) => (
            <MenuItem key={option} value={option}>{t($ => $.detail.deal.feeBases[option])}</MenuItem>
          ))}
        </TextField>
      </Grid>

      {basis === 'percentage' && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={t($ => $.detail.deal.percentage)}
            type="number"
            fullWidth
            value={percentage}
            onChange={(event) => onChange('percentage', event.target.value)}
            placeholder="0"
            helperText={percentageHelp}
            sx={NO_NUMBER_SPINNER_SX}
            slotProps={{
              htmlInput: { min: 0, max: 100, step: 0.5, readOnly: !editable },
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
            }}
          />
        </Grid>
      )}

      {basis === 'amount' && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={t($ => $.detail.deal.fixedAmount)}
            type="number"
            fullWidth
            value={amount}
            onChange={(event) => onChange('amount', event.target.value)}
            placeholder="0.00"
            sx={NO_NUMBER_SPINNER_SX}
            slotProps={{
              htmlInput: { min: 0, step: 0.01, readOnly: !editable },
              input: { startAdornment: <InputAdornment position="start">€</InputAdornment> },
            }}
          />
        </Grid>
      )}
    </>
  )
}
