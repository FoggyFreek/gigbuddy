import { useState } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import { centsToEditableEuro, parseEuroInput } from './invoiceFormHelpers.ts'

interface MoneyInputProps {
  cents?: number
  onChange: (cents: number) => void
  disabled?: boolean
  label?: string
  error?: boolean
  helperText?: string
  sx?: SxProps<Theme>
  currency?: string
}

// Lets the user type freely (e.g. "200") and only commits the parsed cent value
// on blur, preventing the controlled-input loop where every keystroke reformats
// the display value.
export default function MoneyInput({
  cents, onChange, disabled = false, label, error = false, helperText, sx, currency = 'EUR',
}: Readonly<MoneyInputProps>) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)

  return (
    <TextField
      size="small"
      label={label}
      value={focused ? raw : centsToEditableEuro(cents)}
      onChange={(e) => setRaw(e.target.value)}
      onFocus={(e) => {
        setRaw(centsToEditableEuro(cents))
        setFocused(true)
        e.target.select()
      }}
      onBlur={() => {
        setFocused(false)
        onChange(parseEuroInput(raw))
      }}
      disabled={disabled}
      error={error}
      helperText={helperText}
      sx={sx}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              {new Intl.NumberFormat('nl-NL', {
                style: 'currency',
                currency,
                currencyDisplay: 'narrowSymbol',
              }).formatToParts(0).find((part) => part.type === 'currency')?.value}
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
