import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import GigAvailabilityPanel from './GigAvailabilityPanel.jsx'
import GigDetailContent from './GigDetailContent.jsx'
import { createGig } from '../api/gigs.js'
import { dayjsToTimeString, timeStringToDayjs } from '../utils/eventFormUtils.js'

dayjs.extend(customParseFormat)

const STATUSES = ['option', 'confirmed', 'announced']

const EMPTY_FORM = {
  event_date: '',
  event_description: '',
  venue: '',
  city: '',
  start_time: '',
  end_time: '',
  status: 'option',
  notes: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  has_pa_system: false,
  has_drumkit: false,
  has_stage_lights: false,
}

export default function GigFormModal({ mode, gigId, onClose, initialDate }) {
  const contentRef = useRef()

  // ── Create mode state ──────────────────────────────────────────────────────
  const [form, setForm] = useState(() =>
    mode === 'create' && initialDate ? { ...EMPTY_FORM, event_date: initialDate } : EMPTY_FORM
  )
  const [errors, setErrors] = useState({})
  const [focused, setFocused] = useState({ event_date: false })
  const [availabilityData, setAvailabilityData] = useState(null)
  const [confirmCreate, setConfirmCreate] = useState(false)

  // ── Edit mode state ────────────────────────────────────────────────────────
  const [saveLabel, setSaveLabel] = useState('')
  const [saveColor, setSaveColor] = useState('text.secondary')

  useEffect(() => {
    if (mode !== 'edit') return
    const interval = setInterval(() => {
      const status = contentRef.current?.saveStatus
      setSaveLabel({ idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[status] ?? '')
      setSaveColor(status === 'error' ? 'error.main' : 'text.secondary')
    }, 100)
    return () => clearInterval(interval)
  }, [mode])

  const onFocus = (field) => () => setFocused((p) => ({ ...p, [field]: true }))
  const onBlur = (field) => () => setFocused((p) => ({ ...p, [field]: false }))
  const maskSx = (field) => ({
    '& input::-webkit-datetime-edit': {
      opacity: focused[field] || form[field] ? 1 : 0,
    },
  })

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const unavailableLeads = (availabilityData?.members ?? []).filter(
    (m) => m.position === 'lead' && m.status === 'unavailable'
  )

  async function doCreate() {
    await createGig({
      event_date: form.event_date,
      event_description: form.event_description,
      venue: form.venue || null,
      city: form.city || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      status: form.status,
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      has_pa_system: form.has_pa_system,
      has_drumkit: form.has_drumkit,
      has_stage_lights: form.has_stage_lights,
    })
    onClose()
  }

  async function handleCreate() {
    const errs = {}
    if (!form.event_date) errs.event_date = 'Required'
    if (!form.event_description.trim()) errs.event_description = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }

    if (unavailableLeads.length > 0) {
      setConfirmCreate(true)
      return
    }
    await doCreate()
  }

  async function handleClose() {
    await contentRef.current?.flush()
    onClose()
  }

  return (
    <Dialog open fullWidth maxWidth="md" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{mode === 'create' ? 'New gig' : 'Gig details'}</DialogTitle>

      <DialogContent>
        {mode === 'edit' ? (
          <GigDetailContent ref={contentRef} gigId={gigId} />
        ) : (
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Date"
                type="date"
                fullWidth
                value={form.event_date}
                onChange={(e) => handleChange('event_date', e.target.value)}
                onFocus={onFocus('event_date')}
                onBlur={onBlur('event_date')}
                error={!!errors.event_date}
                helperText={errors.event_date}
                slotProps={{ inputLabel: { shrink: focused.event_date || !!form.event_date } }}
                sx={maskSx('event_date')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Event description"
                fullWidth
                value={form.event_description}
                onChange={(e) => handleChange('event_description', e.target.value)}
                error={!!errors.event_description}
                helperText={errors.event_description}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Venue"
                fullWidth
                value={form.venue}
                onChange={(e) => handleChange('venue', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="City"
                fullWidth
                value={form.city}
                onChange={(e) => handleChange('city', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TimePicker
                label="Start time"
                ampm={false}
                value={timeStringToDayjs(form.start_time)}
                onChange={(v) => handleChange('start_time', dayjsToTimeString(v))}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TimePicker
                label="End time"
                ampm={false}
                value={timeStringToDayjs(form.end_time)}
                onChange={(v) => handleChange('end_time', dayjsToTimeString(v))}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label="Status"
                fullWidth
                value={form.status}
                onChange={(e) => handleChange('status', e.target.value)}
              >
                {STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Contact person
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Name"
                fullWidth
                value={form.contact_name}
                onChange={(e) => handleChange('contact_name', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Email"
                type="email"
                fullWidth
                value={form.contact_email}
                onChange={(e) => handleChange('contact_email', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Phone"
                type="tel"
                fullWidth
                value={form.contact_phone}
                onChange={(e) => handleChange('contact_phone', e.target.value)}
              />
            </Grid>

            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Available equipment on-site
              </Typography>
              <FormGroup row>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.has_pa_system}
                      onChange={(e) => handleChange('has_pa_system', e.target.checked)}
                    />
                  }
                  label="PA system"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.has_drumkit}
                      onChange={(e) => handleChange('has_drumkit', e.target.checked)}
                    />
                  }
                  label="Drumkit"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.has_stage_lights}
                      onChange={(e) => handleChange('has_stage_lights', e.target.checked)}
                    />
                  }
                  label="Stage light"
                />
              </FormGroup>
            </Grid>

            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Member availability
              </Typography>
              <GigAvailabilityPanel
                eventDate={form.event_date}
                onDataLoad={setAvailabilityData}
              />
            </Grid>
          </Grid>
        )}
      </DialogContent>

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
            <Button variant="contained" onClick={handleCreate}>Create</Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>Close</Button>
        )}
      </DialogActions>

      <Dialog open={confirmCreate} onClose={() => setConfirmCreate(false)}>
        <DialogTitle>Member unavailable</DialogTitle>
        <DialogContent>
          <Typography>
            {unavailableLeads.map((m) => m.name).join(', ')}{' '}
            {unavailableLeads.length === 1 ? 'is' : 'are'} marked unavailable on this date.
            Are you sure you want to create this gig?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCreate(false)}>Go back</Button>
          <Button variant="contained" color="warning" onClick={() => { setConfirmCreate(false); doCreate() }}>
            Create anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
