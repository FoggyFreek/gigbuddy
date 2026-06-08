import { useState } from 'react'
import PropTypes from 'prop-types'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import { centsToEditableEuro, parseEuroInput } from './invoiceFormHelpers.js'

// Lets the user type freely (e.g. "200") and only commits the parsed cent value
// on blur, preventing the controlled-input loop where every keystroke reformats
// the display value.
export default function MoneyInput({ cents, onChange, disabled = false, label, sx }) {
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
      sx={sx}
      slotProps={{ input: { startAdornment: <InputAdornment position="start">€</InputAdornment> } }}
    />
  )
}

MoneyInput.propTypes = {
  cents: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  label: PropTypes.string,
  sx: PropTypes.object,
}
