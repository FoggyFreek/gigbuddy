import { useState } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import TextField from '@mui/material/TextField'
import { centsToEditableEuro, parseEuroInput } from '../invoices/invoiceFormHelpers.ts'

interface AmountCellProps {
  cents?: number
  active?: boolean
  placeholder?: string
  disabled?: boolean
  onCommit: (cents: number) => void
  sx?: SxProps<Theme>
}

// A debit/credit amount cell. Shows an empty placeholder ("Debit"/"Credit") when
// this side isn't the active one, so only one of the two columns ever shows a
// value. Commits the parsed cent amount on blur (like MoneyInput).
export default function AmountCell({ cents, active, placeholder, disabled, onCommit, sx }: AmountCellProps) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)

  let display = ''
  if (focused) display = raw
  else if (active && (cents ?? 0) > 0) display = centsToEditableEuro(cents)

  return (
    <TextField
      size="small"
      fullWidth
      sx={sx}
      placeholder={placeholder}
      value={display}
      disabled={disabled}
      onChange={(e) => setRaw(e.target.value)}
      onFocus={(e) => {
        setRaw(active && (cents ?? 0) > 0 ? centsToEditableEuro(cents) : '')
        setFocused(true)
        e.target.select()
      }}
      onBlur={() => {
        setFocused(false)
        onCommit(parseEuroInput(raw))
      }}
      slotProps={{ htmlInput: { style: { textAlign: 'right' }, inputMode: 'decimal' } }}
    />
  )
}
