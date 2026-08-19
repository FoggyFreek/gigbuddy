import Box from '@mui/material/Box'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'

interface Props {
  artistLabel: string
  venueLabel: string
  /** The artist's share, as typed. The venue's is always the remainder of 100. */
  value: string
  disabled: boolean
  onChange: (next: string) => void
}

// The venue's share is never stored — it is 100 minus the artist's, derived on
// every render. Editing either box therefore keeps the pair at 100 by
// construction rather than by a syncing effect.
function venueShareOf(artistShare: string): string {
  if (artistShare.trim() === '') return ''
  const artist = Number.parseFloat(artistShare)
  if (Number.isNaN(artist)) return ''
  return String(Math.min(100, Math.max(0, 100 - artist)))
}

function artistShareOf(venueShare: string): string {
  if (venueShare.trim() === '') return ''
  const venue = Number.parseFloat(venueShare)
  if (Number.isNaN(venue)) return ''
  return String(Math.min(100, Math.max(0, 100 - venue)))
}

export default function PercentSplitField({ artistLabel, venueLabel, value, disabled, onChange }: Readonly<Props>) {
  const numberProps = {
    htmlInput: { min: 0, max: 100, step: 0.5, readOnly: disabled },
    input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TextField
        label={artistLabel}
        type="number"
        fullWidth
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        sx={NO_NUMBER_SPINNER_SX}
        slotProps={numberProps}
      />
      <Typography aria-hidden sx={{ color: 'text.secondary' }}>/</Typography>
      <TextField
        label={venueLabel}
        type="number"
        fullWidth
        value={venueShareOf(value)}
        onChange={(event) => onChange(artistShareOf(event.target.value))}
        placeholder="0"
        sx={NO_NUMBER_SPINNER_SX}
        slotProps={numberProps}
      />
    </Box>
  )
}
