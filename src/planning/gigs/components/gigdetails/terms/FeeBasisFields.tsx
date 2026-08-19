import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { useTranslation } from 'react-i18next'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'
import FieldHelpAdornment from '../FieldHelpAdornment.tsx'
import { FEE_BASES } from '../../../dealTerms.ts'
import type { FeeBasis } from '../../../dealTerms.ts'

interface Props {
  basisLabel: string
  basis: FeeBasis
  percentage: string
  amount: string
  /** What the percentage is taken from, behind the percentage field's help icon. */
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

  // Plain fields, not grid cells: the owning section lays the whole block out on
  // one line, and the basis decides how many fields there are to lay out.
  return (
    <>
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

      {basis === 'percentage' && (
        <TextField
          label={t($ => $.detail.deal.percentage)}
          type="number"
          fullWidth
          value={percentage}
          onChange={(event) => onChange('percentage', event.target.value)}
          placeholder="0"
          sx={NO_NUMBER_SPINNER_SX}
          slotProps={{
            htmlInput: { min: 0, max: 100, step: 0.5, readOnly: !editable },
            // The unit and the explanation share the field's end.
            input: { endAdornment: <FieldHelpAdornment help={percentageHelp}>%</FieldHelpAdornment> },
          }}
        />
      )}

      {basis === 'amount' && (
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
      )}
    </>
  )
}
