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
import DateEntryField from './DateEntryField.jsx'
import GigAvailabilityPanel from './GigAvailabilityPanel.jsx'
import GigDetailContent from './GigDetailContent.jsx'
import SaveStatusLabel from './SaveStatusLabel.jsx'
import VenuePicker from './VenuePicker.jsx'
import { createGig } from '../api/gigs.js'
import { dayjsToTimeString, timeStringToDayjs } from '../utils/eventFormUtils.js'

dayjs.extend(customParseFormat)

const STATUSES = ['option', 'confirmed', 'announced']

const EMPTY_FORM = {
  event_date: '',
  event_description: '',
  venue_id: null,
  festival_id: null,
  start_time: '',
  end_time: '',
  status: 'option',
  notes: '',
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
  const [selectedVenue, setSelectedVenue] = useState(null)
  const [selectedFestival, setSelectedFestival] = useState(null)
  const [errors, setErrors] = useState({})
  const [availabilityData, setAvailabilityData] = useState(null)
  const [confirmCreate, setConfirmCreate] = useState(false)

  // ── Edit mode state ────────────────────────────────────────────────────────
  const [polledStatus, setPolledStatus] = useState('idle')

  useEffect(() => {
    if (mode !== 'edit') return
    const interval = setInterval(() => {
      setPolledStatus(contentRef.current?.saveStatus ?? 'idle')
    }, 100)
    return () => clearInterval(interval)
  }, [mode])

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
      venue_id: form.venue_id,
      festival_id: form.festival_id,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      status: form.status,
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
              <DateEntryField
                label="Date"
                fullWidth
                value={form.event_date}
                onChange={(e) => handleChange('event_date', e.target.value)}
                error={!!errors.event_date}
                helperText={errors.event_date}
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
              <VenuePicker
                categoryFilter="festival"
                value={selectedFestival}
                onChange={(v) => {
                  setSelectedFestival(v)
                  handleChange('festival_id', v?.id ?? null)
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <VenuePicker
                categoryFilter="venue"
                value={selectedVenue}
                onChange={(v) => {
                  setSelectedVenue(v)
                  handleChange('venue_id', v?.id ?? null)
                }}
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
        {mode === 'edit' && <SaveStatusLabel status={polledStatus} />}
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
