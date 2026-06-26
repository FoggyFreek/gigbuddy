import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import { useTranslation } from 'react-i18next'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import DateEntryField from './DateEntryField.tsx'
import { dayjsToTimeString, timeStringToDayjs } from '../utils/eventFormUtils.ts'

dayjs.extend(customParseFormat)

interface RehearsalForm {
  proposed_date?: string
  location?: string
  start_time?: string
  end_time?: string
}

interface RehearsalFieldsProps {
  form: RehearsalForm
  onChange: (field: string, value: string | null) => void
  errors?: Record<string, string | undefined>
}

export default function RehearsalFields({ form, onChange, errors = {} }: RehearsalFieldsProps) {
  const { t } = useTranslation('rehearsals')
  return (
    <>
      <Grid size={{ xs: 12, sm: 6 }}>
        <DateEntryField
          label={t($ => $.form.date)}
          fullWidth
          required
          value={form.proposed_date}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('proposed_date', e.target.value)}
          error={!!errors.proposed_date}
          helperText={errors.proposed_date}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label={t($ => $.form.location)}
          fullWidth
          value={form.location}
          onChange={(e) => onChange('location', e.target.value)}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 4 }}>
        <TimePicker
          label={t($ => $.form.startTime)}
          ampm={false}
          value={timeStringToDayjs(form.start_time)}
          onChange={(v) => onChange('start_time', dayjsToTimeString(v))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 4 }}>
        <TimePicker
          label={t($ => $.form.endTime)}
          ampm={false}
          value={timeStringToDayjs(form.end_time)}
          onChange={(v) => onChange('end_time', dayjsToTimeString(v))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
    </>
  )
}
