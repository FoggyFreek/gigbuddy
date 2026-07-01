import { useRef, useState } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'

interface DateEntryFieldProps {
  value?: string
  label: string
  onChange: React.ChangeEventHandler<HTMLInputElement>
  openPickerLabel?: string
  slotProps?: {
    htmlInput?: Record<string, unknown>
    input?: { endAdornment?: React.ReactNode; [key: string]: unknown }
    inputLabel?: { shrink?: boolean; [key: string]: unknown }
  }
  sx?: SxProps<Theme>
  disabled?: boolean
  onFocus?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>
  onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>
  [key: string]: unknown
}

export default function DateEntryField({
  value,
  label,
  onChange,
  openPickerLabel = 'open date picker',
  slotProps = {},
  sx,
  disabled = false,
  onFocus,
  onBlur,
  ...textFieldProps
}: Readonly<DateEntryFieldProps>) {
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  function openDatePicker() {
    if (disabled) return
    inputRef.current?.focus()
    ;(inputRef.current as HTMLInputElement & { showPicker?: () => void })?.showPicker?.()
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

  const maskSx: SxProps<Theme> = {
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
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
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
