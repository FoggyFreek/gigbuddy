import { useTranslation } from 'react-i18next'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import DateEntryField from './DateEntryField.tsx'
import { dayjsToTimeString, timeStringToDayjs } from '../utils/eventFormUtils.ts'

dayjs.extend(customParseFormat)

interface BandEventFieldsProps {
  form: {
    title: string
    start_date: string
    end_date: string
    start_time: string
    end_time: string
    location: string
    notes: string
  }
  onChange: (field: string, value: string | boolean | null) => void
  errors?: Record<string, string | undefined>
}

export default function BandEventFields({ form, onChange, errors = {} }: Readonly<BandEventFieldsProps>) {
  const { t } = useTranslation('bandEvents')
  return (
    <>
      <Grid size={12}>
        <TextField
          label={t($ => $.form.title)}
          fullWidth
          required
          value={form.title}
          onChange={(e) => onChange('title', e.target.value)}
          error={!!errors.title}
          helperText={errors.title}
          placeholder={t($ => $.form.titlePlaceholder)}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <DateEntryField
          label={t($ => $.form.startDate)}
          fullWidth
          required
          value={form.start_date}
          onChange={(e) => onChange('start_date', e.target.value)}
          error={!!errors.start_date}
          helperText={errors.start_date}
          openPickerLabel={t($ => $.form.openStartPicker)}
          sx={{}}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <DateEntryField
          label={t($ => $.form.endDate)}
          fullWidth
          value={form.end_date}
          onChange={(e) => onChange('end_date', e.target.value)}
          error={!!errors.end_date}
          helperText={errors.end_date || t($ => $.form.endDateHint)}
          openPickerLabel={t($ => $.form.openEndPicker)}
          sx={{}}
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label={t($ => $.form.location)}
          fullWidth
          value={form.location}
          onChange={(e) => onChange('location', e.target.value)}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <TimePicker
          label={t($ => $.form.startTime)}
          ampm={false}
          value={timeStringToDayjs(form.start_time)}
          onChange={(v) => onChange('start_time', dayjsToTimeString(v))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <TimePicker
          label={t($ => $.form.endTime)}
          ampm={false}
          value={timeStringToDayjs(form.end_time)}
          onChange={(v) => onChange('end_time', dayjsToTimeString(v))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label={t($ => $.form.notes)}
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
