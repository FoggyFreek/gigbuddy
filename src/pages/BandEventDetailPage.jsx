import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { getBandEvent, updateBandEvent } from '../api/bandEvents.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'

dayjs.extend(customParseFormat)

function timeStringToDayjs(val) {
  if (!val) return null
  const d = dayjs(val, 'HH:mm')
  return d.isValid() ? d : null
}

function dayjsToTimeString(d) {
  if (!d || !d.isValid()) return ''
  return d.format('HH:mm')
}

function toDateInput(val) {
  if (!val) return ''
  return String(val).slice(0, 10)
}

export default function BandEventDetailPage() {
  const { id } = useParams()
  const bandEventId = Number(id)
  const navigate = useNavigate()

  const [form, setForm] = useState({
    title: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    location: '',
    notes: '',
  })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [focused, setFocused] = useState({ start_date: false, end_date: false })

  const onFocus = (field) => () => setFocused((p) => ({ ...p, [field]: true }))
  const onBlur = (field) => () => setFocused((p) => ({ ...p, [field]: false }))
  const maskSx = (field) => ({
    '& input::-webkit-datetime-edit': {
      opacity: focused[field] || form[field] ? 1 : 0,
    },
  })

  const saveFn = useCallback(
    async (patch) => { await updateBandEvent(bandEventId, patch) },
    [bandEventId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    getBandEvent(bandEventId)
      .then((ev) => {
        setForm({
          title: ev.title || '',
          start_date: toDateInput(ev.start_date),
          end_date: toDateInput(ev.end_date),
          start_time: ev.start_time ? String(ev.start_time).slice(0, 5) : '',
          end_time: ev.end_time ? String(ev.end_time).slice(0, 5) : '',
          location: ev.location || '',
          notes: ev.notes || '',
        })
      })
      .finally(() => setLoading(false))
  }, [bandEventId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    schedule({ [field]: value || null })
  }

  async function handleBack() {
    await flush()
    navigate(-1)
  }

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <IconButton onClick={handleBack} aria-label="back">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600}>Band event</Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <Grid size={12}>
            <TextField
              label="Title"
              fullWidth
              value={form.title}
              onChange={(e) => handleChange('title', e.target.value)}
              error={!!errors.title}
              helperText={errors.title}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Start date"
              type="date"
              fullWidth
              value={form.start_date}
              onChange={(e) => handleChange('start_date', e.target.value)}
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
              onChange={(e) => handleChange('end_date', e.target.value)}
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
              onChange={(e) => handleChange('location', e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TimePicker
              label="Start time"
              ampm={false}
              value={timeStringToDayjs(form.start_time)}
              onChange={(v) => handleChange('start_time', dayjsToTimeString(v))}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TimePicker
              label="End time"
              ampm={false}
              value={timeStringToDayjs(form.end_time)}
              onChange={(v) => handleChange('end_time', dayjsToTimeString(v))}
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
              onChange={(e) => handleChange('notes', e.target.value)}
            />
          </Grid>
        </Grid>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
        <Button variant="contained" onClick={handleBack}>Close</Button>
      </Box>
    </Box>
  )
}
