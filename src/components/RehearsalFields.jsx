import { useRef, useState } from 'react'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { dayjsToTimeString, timeStringToDayjs } from '../utils/eventFormUtils.js'

dayjs.extend(customParseFormat)

export default function RehearsalFields({ form, onChange, errors = {} }) {
  const [focused, setFocused] = useState({ proposed_date: false })
  const dateInputRef = useRef(null)

  const onFocus = (field) => () => setFocused((p) => ({ ...p, [field]: true }))
  const onBlur = (field) => () => setFocused((p) => ({ ...p, [field]: false }))
  const openDatePicker = () => {
    dateInputRef.current?.focus()
    dateInputRef.current?.showPicker?.()
  }
  const dateSlotProps = {
    htmlInput: { ref: dateInputRef },
    input: {
      endAdornment: (
        <InputAdornment position="end">
          <IconButton
            edge="end"
            size="small"
            aria-label="open date picker"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openDatePicker}
          >
            <CalendarMonthIcon fontSize="small" sx={{ color: 'action.active' }} />
          </IconButton>
        </InputAdornment>
      ),
    },
    inputLabel: { shrink: focused.proposed_date || !!form.proposed_date },
  }
  const maskSx = (field) => ({
    '& input::-webkit-datetime-edit': {
      opacity: focused[field] || form[field] ? 1 : 0,
    },
    '& input::-webkit-calendar-picker-indicator': {
      display: 'none',
    },
  })

  return (
    <>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Date"
          type="date"
          fullWidth
          required
          value={form.proposed_date}
          onChange={(e) => onChange('proposed_date', e.target.value)}
          onFocus={onFocus('proposed_date')}
          onBlur={onBlur('proposed_date')}
          error={!!errors.proposed_date}
          helperText={errors.proposed_date}
          slotProps={dateSlotProps}
          sx={maskSx('proposed_date')}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Location"
          fullWidth
          value={form.location}
          onChange={(e) => onChange('location', e.target.value)}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 4 }}>
        <TimePicker
          label="Start time"
          ampm={false}
          value={timeStringToDayjs(form.start_time)}
          onChange={(v) => onChange('start_time', dayjsToTimeString(v))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 4 }}>
        <TimePicker
          label="End time"
          ampm={false}
          value={timeStringToDayjs(form.end_time)}
          onChange={(v) => onChange('end_time', dayjsToTimeString(v))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
    </>
  )
}
