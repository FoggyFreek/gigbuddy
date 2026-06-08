import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import DateEntryField from './DateEntryField.jsx'
import { dayjsToTimeString, timeStringToDayjs } from '../utils/eventFormUtils.js'

dayjs.extend(customParseFormat)

export default function RehearsalFields({ form, onChange, errors = {} }) {
  return (
    <>
      <Grid size={{ xs: 12, sm: 6 }}>
        <DateEntryField
          label="Date"
          fullWidth
          required
          value={form.proposed_date}
          onChange={(e) => onChange('proposed_date', e.target.value)}
          error={!!errors.proposed_date}
          helperText={errors.proposed_date}
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

RehearsalFields.propTypes = {
  form: PropTypes.shape({
    proposed_date: PropTypes.string,
    location: PropTypes.string,
    start_time: PropTypes.string,
    end_time: PropTypes.string,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  errors: PropTypes.objectOf(PropTypes.string),
}
