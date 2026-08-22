import Box from '@mui/material/Box'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { useTranslation } from 'react-i18next'
import { lineCellSx, lineFieldSx } from '../lineTableSx.ts'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'
import FieldHelpAdornment from '../FieldHelpAdornment.tsx'
import { FEE_BASES } from '../../../dealTerms.ts'
import type { FeeBasis } from '../../../dealTerms.ts'

const euroAdornment = <InputAdornment position="start">€</InputAdornment>

interface Props {
  basisLabel: string
  percentageLabel: string
  amountLabel: string
  basis: FeeBasis
  percentage: string
  amount: string
  /** What the percentage is taken from, behind the percentage field's help icon. */
  percentageHelp: string
  editable: boolean
  onChange: (field: 'basis' | 'percentage' | 'amount', value: string) => void
}

// The booking fee and the commission are both "a percentage of something, or a
// fixed amount" — one shape, used twice, with the basis as the discriminator.
// Both fields stay on the row and grey out rather than disappear, so the basis
// (including "none") never changes how many columns the table has.
export default function FeeBasisFields({
  basisLabel,
  percentageLabel,
  amountLabel,
  basis,
  percentage,
  amount,
  percentageHelp,
  editable,
  onChange,
}: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const percentageActive = basis === 'percentage'
  const amountActive = basis === 'amount'

  return (
    <>
      <Box sx={lineCellSx}>
        <TextField
          select
          variant="standard"
          fullWidth
          value={basis}
          disabled={!editable}
          onChange={(event) => onChange('basis', event.target.value)}
          sx={lineFieldSx}
          slotProps={{
            input: { disableUnderline: true },
            htmlInput: { 'aria-label': basisLabel },
          }}
        >
          {FEE_BASES.map((option) => (
            <MenuItem key={option} value={option}>{t($ => $.detail.deal.feeBases[option])}</MenuItem>
          ))}
        </TextField>
      </Box>

      <Box sx={lineCellSx}>
        <TextField
          variant="standard"
          type="number"
          fullWidth
          value={percentage}
          disabled={!percentageActive}
          onChange={(event) => onChange('percentage', event.target.value)}
          placeholder="0"
          sx={{ ...lineFieldSx, ...NO_NUMBER_SPINNER_SX }}
          slotProps={{
            htmlInput: { min: 0, max: 100, step: 0.5, readOnly: !editable, 'aria-label': percentageLabel },
            input: {
              disableUnderline: true,
              endAdornment: <FieldHelpAdornment help={percentageHelp}>%</FieldHelpAdornment>,
            },
          }}
        />
      </Box>

      <Box sx={lineCellSx}>
        <TextField
          variant="standard"
          type="number"
          fullWidth
          value={amount}
          disabled={!amountActive}
          onChange={(event) => onChange('amount', event.target.value)}
          placeholder="0.00"
          sx={{ ...lineFieldSx, ...NO_NUMBER_SPINNER_SX }}
          slotProps={{
            htmlInput: { min: 0, step: 0.01, readOnly: !editable, 'aria-label': amountLabel },
            input: {
              disableUnderline: true,
              startAdornment: euroAdornment,
            },
          }}
        />
      </Box>
    </>
  )
}
