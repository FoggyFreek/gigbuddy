import { useState } from 'react'
import PropTypes from 'prop-types'
import TextField from '@mui/material/TextField'
import { centsToEditableEuro, parseEuroInput } from '../invoices/invoiceFormHelpers.js'

// A debit/credit amount cell. Shows an empty placeholder ("Debit"/"Credit") when
// this side isn't the active one, so only one of the two columns ever shows a
// value. Commits the parsed cent amount on blur (like MoneyInput).
export default function AmountCell({ cents, active, placeholder, disabled, onCommit, sx }) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)

  const display = focused
    ? raw
    : (active && cents > 0 ? centsToEditableEuro(cents) : '')

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
        setRaw(active && cents > 0 ? centsToEditableEuro(cents) : '')
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

AmountCell.propTypes = {
  cents: PropTypes.number,
  active: PropTypes.bool,
  placeholder: PropTypes.string,
  disabled: PropTypes.bool,
  onCommit: PropTypes.func.isRequired,
  sx: PropTypes.object,
}
