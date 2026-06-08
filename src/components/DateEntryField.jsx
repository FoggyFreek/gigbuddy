import { useRef, useState } from 'react'
import PropTypes from 'prop-types'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'

export default function DateEntryField({
  value,
  label,
  onChange,
  openPickerLabel = 'open date picker',
  slotProps = {},
  sx,
  disabled = false,
  ...textFieldProps
}) {
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  function openDatePicker() {
    if (disabled) return
    inputRef.current?.focus()
    inputRef.current?.showPicker?.()
  }

  const htmlInputSlotProps = {
    ...slotProps.htmlInput,
    ref: inputRef,
  }
  const inputSlotProps = {
    ...slotProps.input,
    endAdornment: (
      <>
        {slotProps.input?.endAdornment}
        <InputAdornment position="end">
          <IconButton
            edge="end"
            size="small"
            aria-label={openPickerLabel}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={openDatePicker}
          >
            <CalendarMonthIcon fontSize="small" sx={{ color: 'action.active' }} />
          </IconButton>
        </InputAdornment>
      </>
    ),
  }
  const inputLabelSlotProps = {
    ...slotProps.inputLabel,
    shrink: focused || Boolean(value) || slotProps.inputLabel?.shrink,
  }

  const maskSx = {
    '& input::-webkit-datetime-edit': {
      opacity: focused || value ? 1 : 0,
    },
    '& input::-webkit-calendar-picker-indicator': {
      display: 'none',
    },
  }

  return (
    <TextField
      {...textFieldProps}
      label={label}
      type="date"
      value={value || ''}
      onChange={onChange}
      onFocus={(e) => {
        setFocused(true)
        textFieldProps.onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        textFieldProps.onBlur?.(e)
      }}
      disabled={disabled}
      slotProps={{
        ...slotProps,
        htmlInput: htmlInputSlotProps,
        input: inputSlotProps,
        inputLabel: inputLabelSlotProps,
      }}
      sx={[maskSx, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  )
}

DateEntryField.propTypes = {
  value: PropTypes.string,
  label: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  openPickerLabel: PropTypes.string,
  slotProps: PropTypes.shape({
    htmlInput: PropTypes.object,
    input: PropTypes.object,
    inputLabel: PropTypes.object,
  }),
  sx: PropTypes.oneOfType([PropTypes.object, PropTypes.array, PropTypes.func]),
  disabled: PropTypes.bool,
}
