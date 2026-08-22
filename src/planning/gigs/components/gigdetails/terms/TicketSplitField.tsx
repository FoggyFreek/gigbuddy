import { useState } from 'react'
import Box from '@mui/material/Box'
import InputAdornment from '@mui/material/InputAdornment'
import InputBase from '@mui/material/InputBase'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'
import { FieldHelpIcon } from '../FieldHelpAdornment.tsx'

interface Props {
  /** The one label for the pair. It names the stored share. */
  label: string
  /** The derived share's name, for assistive technology. */
  complementLabel: string
  /** Which share is which; the boxes themselves only show numbers. */
  help: string
  /** The stored share, as typed. The other one is always the remainder of 100. */
  value: string
  disabled: boolean
  onChange: (next: string) => void
}

// The second share is never stored — it is 100 minus the first, derived on every
// render. Editing either box therefore keeps the pair at 100 by construction
// rather than by a syncing effect. Both sides always show one decimal.
function complementOf(share: string): string {
  if (share.trim() === '') return ''
  const parsed = Number.parseFloat(share)
  if (Number.isNaN(parsed)) return ''
  return Math.min(100, Math.max(0, 100 - parsed)).toFixed(1)
}

// The stored share keeps whatever the user typed while they're typing, but
// always settles back to one decimal once they move on — same pattern as the
// money fields' onBlur rounding.
function roundToOneDecimal(share: string): string {
  if (share.trim() === '') return ''
  const parsed = Number.parseFloat(share)
  return Number.isNaN(parsed) ? share : parsed.toFixed(1)
}

const PERCENT_BOUNDS = { min: 0, max: 100, step: 0.1 }

// Two shares of the same 100%, presented as one field: `70 / 30` inside a
// single outline under a single label. Splitting it into two labelled fields
// invited the reading that they were independent numbers.
export default function TicketSplitField({
  label,
  complementLabel,
  help,
  value,
  disabled,
  onChange,
}: Readonly<Props>) {
  // The second box lives in the field's adornment, so focus there would leave
  // the outline looking idle. Focus anywhere inside lights the whole field.
  const [focusedInside, setFocusedInside] = useState(false)

  return (
    <Box onFocus={() => setFocusedInside(true)} onBlur={() => setFocusedInside(false)}>
      <TextField
        label={label}
        type="number"
        fullWidth
        focused={focusedInside || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onChange(roundToOneDecimal(event.target.value))}
        placeholder="0"
        sx={{ ...NO_NUMBER_SPINNER_SX, '& input': { textAlign: 'right' } }}
        slotProps={{
          htmlInput: { ...PERCENT_BOUNDS, readOnly: disabled },
          input: {
            endAdornment: (
              <InputAdornment position="end" sx={{ gap: 0.75 }}>
                <Typography aria-hidden sx={{ color: 'text.secondary' }}>/</Typography>
                <InputBase
                  type="number"
                  value={complementOf(value)}
                  onChange={(event) => onChange(complementOf(event.target.value))}
                  placeholder="0"
                  sx={{ ...NO_NUMBER_SPINNER_SX, width: '5ch', '& input': { p: 0, textAlign: 'right' } }}
                  slotProps={{
                    input: { ...PERCENT_BOUNDS, readOnly: disabled, 'aria-label': complementLabel },
                  }}
                />
                <FieldHelpIcon help={help} />
              </InputAdornment>
            ),
          },
        }}
      />
    </Box>
  )
}
