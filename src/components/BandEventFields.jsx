import { useState } from 'react'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { dayjsToTimeString, timeStringToDayjs } from '../utils/eventFormUtils.js'

dayjs.extend(customParseFormat)

export default function BandEventFields({ form, onChange, errors = {} }) {
  const [focused, setFocused] = useState({ start_date: false, end_date: false })

  const onFocus = (field) => () => setFocused((p) => ({ ...p, [field]: true }))
  const onBlur = (field) => () => setFocused((p) => ({ ...p, [field]: false }))
  const maskSx = (field) => ({
    '& input::-webkit-datetime-edit': {
      opacity: focused[field] || form[field] ? 1 : 0,
    },
  })

  return (
    <>
      <Grid size={12}>
        <TextField
          label="Title"
          fullWidth
          required
          value={form.title}
          onChange={(e) => onChange('title', e.target.value)}
          error={!!errors.title}
          helperText={errors.title}
          placeholder="e.g. Studio session, Photo shoot, Band meeting"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Start date"
          type="date"
          fullWidth
          required
          value={form.start_date}
          onChange={(e) => onChange('start_date', e.target.value)}
          onFocus={onFocus('start_date')}
          onBlur={onBlur('start_date')}
          error={!!errors.start_date}
          helperText={errors.start_date}
          slotProps={{ inputLabel: { shrink: focused.start_date || !!form.start_date } }}
          sx={maskSx('start_date')}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="End date"
          type="date"
          fullWidth
          value={form.end_date}
          onChange={(e) => onChange('end_date', e.target.value)}
          onFocus={onFocus('end_date')}
          onBlur={onBlur('end_date')}
          error={!!errors.end_date}
          helperText={errors.end_date || 'Leave blank for single day'}
          slotProps={{ inputLabel: { shrink: focused.end_date || !!form.end_date } }}
          sx={maskSx('end_date')}
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label="Location"
          fullWidth
          value={form.location}
          onChange={(e) => onChange('location', e.target.value)}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <TimePicker
          label="Start time"
          ampm={false}
          value={timeStringToDayjs(form.start_time)}
          onChange={(v) => onChange('start_time', dayjsToTimeString(v))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <TimePicker
          label="End time"
          ampm={false}
          value={timeStringToDayjs(form.end_time)}
          onChange={(v) => onChange('end_time', dayjsToTimeString(v))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label="Notes"
          fullWidth
          multiline
          minRows={3}
          value={form.notes}
          onChange={(e) => onChange('notes', e.target.value)}
        />
      </Grid>
    </>
  )
}
