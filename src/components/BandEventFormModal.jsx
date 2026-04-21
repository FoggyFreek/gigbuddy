import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { createBandEvent, getBandEvent, updateBandEvent } from '../api/bandEvents.js'
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

const EMPTY_FORM = {
  title: '',
  event_date: '',
  start_time: '',
  end_time: '',
  location: '',
  notes: '',
}

function toDateInput(val) {
  if (!val) return ''
  return String(val).slice(0, 10)
}

export default function BandEventFormModal({ mode, bandEventId, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [focused, setFocused] = useState({ event_date: false })

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
    if (mode !== 'edit') return
    getBandEvent(bandEventId)
      .then((ev) => {
        setForm({
          title: ev.title || '',
          event_date: toDateInput(ev.event_date),
          start_time: ev.start_time ? String(ev.start_time).slice(0, 5) : '',
          end_time: ev.end_time ? String(ev.end_time).slice(0, 5) : '',
          location: ev.location || '',
          notes: ev.notes || '',
        })
      })
      .finally(() => setLoading(false))
  }, [mode, bandEventId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') schedule({ [field]: value || null })
  }

  async function handleCreate() {
    const errs = {}
    if (!form.title.trim()) errs.title = 'Required'
    if (!form.event_date) errs.event_date = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    await createBandEvent({
      title: form.title.trim(),
      event_date: form.event_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      location: form.location || null,
      notes: form.notes || null,
    })
    onClose()
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  const saveLabel = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{mode === 'create' ? 'Add band event' : 'Band event'}</DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={12}>
              <TextField
                label="Title"
                fullWidth
                required
                value={form.title}
                onChange={(e) => handleChange('title', e.target.value)}
                error={!!errors.title}
                helperText={errors.title}
                placeholder="e.g. Studio session, Photo shoot, Band meeting"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Date"
                type="date"
                fullWidth
                required
                value={form.event_date}
                onChange={(e) => handleChange('event_date', e.target.value)}
                onFocus={onFocus('event_date')}
                onBlur={onBlur('event_date')}
                error={!!errors.event_date}
                helperText={errors.event_date}
                InputLabelProps={{ shrink: focused.event_date || !!form.event_date }}
                sx={maskSx('event_date')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
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
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && (
          <Typography variant="caption" color={saveColor}>
            {saveLabel}
          </Typography>
        )}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'create' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate}>Add event</Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
