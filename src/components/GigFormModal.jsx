import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import GigTasks from './GigTasks.jsx'
import GigAvailabilityPanel from './GigAvailabilityPanel.jsx'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { addGigParticipant, createGig, getGig, removeGigParticipant, setGigVote, updateGig } from '../api/gigs.js'
import { listMembers } from '../api/bandMembers.js'

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

const STATUSES = ['option', 'confirmed', 'announced']

const EMPTY_FORM = {
  event_date: '',
  event_description: '',
  venue: '',
  city: '',
  start_time: '',
  end_time: '',
  status: 'option',
  booking_fee: '',
  notes: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  has_pa_system: false,
  has_drumkit: false,
}

function feeToDisplay(cents) {
  if (cents == null || cents === '') return ''
  return (cents / 100).toFixed(2)
}

function feeToCents(str) {
  const n = parseFloat(str)
  if (isNaN(n)) return null
  return Math.round(n * 100)
}

function toDateInput(val) {
  if (!val) return ''
  return val.slice(0, 10)
}

function toTimeInput(val) {
  if (!val) return ''
  return val.slice(0, 5)
}

function VoteToggle({ vote, onChange }) {
  return (
    <ButtonGroup size="small" variant="outlined">
      <Button
        variant={vote === 'yes' ? 'contained' : 'outlined'}
        color="success"
        onClick={() => onChange(vote === 'yes' ? null : 'yes')}
      >
        Yes
      </Button>
      <Button
        variant={vote === 'no' ? 'contained' : 'outlined'}
        color="error"
        onClick={() => onChange(vote === 'no' ? null : 'no')}
      >
        No
      </Button>
    </ButtonGroup>
  )
}

export default function GigFormModal({ mode, gigId, onClose, initialDate }) {
  const [form, setForm] = useState(() =>
    mode === 'create' && initialDate ? { ...EMPTY_FORM, event_date: initialDate } : EMPTY_FORM
  )
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [initialTasks, setInitialTasks] = useState([])
  const [focused, setFocused] = useState({ event_date: false })
  const [gig, setGig] = useState(null)
  const [members, setMembers] = useState([])
  const [addMemberId, setAddMemberId] = useState('')
  const [availabilityData, setAvailabilityData] = useState(null)
  const [confirmCreate, setConfirmCreate] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)

  const handleCopyEmail = () => {
    if (!form.contact_email) return
    navigator.clipboard.writeText(form.contact_email)
    setEmailCopied(true)
    setTimeout(() => setEmailCopied(false), 1500)
  }

  const onFocus = (field) => () => setFocused((p) => ({ ...p, [field]: true }))
  const onBlur = (field) => () => setFocused((p) => ({ ...p, [field]: false }))
  const maskSx = (field) => ({
    '& input::-webkit-datetime-edit': {
      opacity: focused[field] || form[field] ? 1 : 0,
    },
  })

  const saveFn = useCallback(
    async (patch) => { await updateGig(gigId, patch) },
    [gigId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  const applyGig = useCallback((g) => {
    setGig(g)
    setForm({
      event_date: toDateInput(g.event_date),
      event_description: g.event_description || '',
      venue: g.venue || '',
      city: g.city || '',
      start_time: toTimeInput(g.start_time),
      end_time: toTimeInput(g.end_time),
      status: g.status || 'option',
      booking_fee: feeToDisplay(g.booking_fee_cents),
      notes: g.notes || '',
      contact_name: g.contact_name || '',
      contact_email: g.contact_email || '',
      contact_phone: g.contact_phone || '',
      has_pa_system: !!g.has_pa_system,
      has_drumkit: !!g.has_drumkit,
    })
    setInitialTasks(g.tasks || [])
  }, [])

  const refresh = useCallback(async () => {
    if (mode !== 'edit') return
    const g = await getGig(gigId)
    applyGig(g)
  }, [mode, gigId, applyGig])

  useEffect(() => {
    if (mode !== 'edit') return
    listMembers().then(setMembers).catch(() => {})
    getGig(gigId)
      .then(applyGig)
      .finally(() => setLoading(false))
  }, [mode, gigId, applyGig])

  const participantIds = useMemo(
    () => new Set((gig?.participants ?? []).map((p) => p.band_member_id)),
    [gig]
  )
  const candidateMembers = members.filter((m) => !participantIds.has(m.id))

  async function handleVote(memberId, vote) {
    await setGigVote(gigId, memberId, vote)
    await refresh()
  }

  async function handleRemoveParticipant(memberId) {
    await removeGigParticipant(gigId, memberId)
    await refresh()
  }

  async function handleAddParticipant() {
    if (!addMemberId) return
    await addGigParticipant(gigId, Number(addMemberId))
    setAddMemberId('')
    await refresh()
  }

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') {
      const patch = { [field]: value }
      if (field === 'booking_fee') {
        patch.booking_fee_cents = feeToCents(value)
        delete patch.booking_fee
      }
      schedule(patch)
    }
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
    <Dialog open fullWidth maxWidth="md" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{mode === 'create' ? 'New gig' : 'Gig details'}</DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            {/* Left column */}
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
                InputLabelProps={{ shrink: focused.event_date || !!form.event_date }}
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

            {mode === 'edit' && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Band fee"
                  fullWidth
                  value={form.booking_fee}
                  onChange={(e) => handleChange('booking_fee', e.target.value)}
                  placeholder="0.00"
                  slotProps={{
                    input: {
                    startAdornment: <InputAdornment position="start">€</InputAdornment>,
                  },
                }}
                />
              </Grid>
            )}

            {/* Contact person */}
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
                slotProps={{
                  input: {
                    endAdornment: form.contact_email ? (
                      <InputAdornment position="end">
                        <Tooltip title={emailCopied ? 'Copied!' : 'Copy email'}>
                          <IconButton size="small" onClick={handleCopyEmail} edge="end">
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ) : null,
                  },
                }}
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

            {/* Equipment */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Equipment
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
              </FormGroup>
            </Grid>

            {/* Availability / Participants */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Member availability
              </Typography>
              {mode === 'edit' && form.status === 'option' ? (
                <Stack spacing={1}>
                  {gig?.participants?.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No participants yet — add one below.
                    </Typography>
                  )}
                  {(gig?.participants ?? []).map((p) => (
                    <Box
                      key={p.band_member_id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                      }}
                    >
                      <Box
                        sx={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          bgcolor: p.color || 'grey.400',
                        }}
                      />
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
                        {p.name}
                      </Typography>
                      <Chip size="small" label={p.position} variant="outlined" />
                      <Box sx={{ flexGrow: 1 }} />
                      <VoteToggle
                        vote={p.vote}
                        onChange={(v) => handleVote(p.band_member_id, v)}
                      />
                      <IconButton
                        size="small"
                        aria-label={`remove ${p.name}`}
                        onClick={() => handleRemoveParticipant(p.band_member_id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                  {candidateMembers.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                      <FormControl size="small" sx={{ minWidth: 220 }}>
                        <InputLabel id="add-gig-participant-label">Add participant</InputLabel>
                        <Select
                          labelId="add-gig-participant-label"
                          label="Add participant"
                          value={addMemberId}
                          onChange={(e) => setAddMemberId(e.target.value)}
                        >
                          {candidateMembers.map((m) => (
                            <MenuItem key={m.id} value={m.id}>
                              {m.name} ({m.position})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        variant="outlined"
                        disabled={!addMemberId}
                        onClick={handleAddParticipant}
                      >
                        Add
                      </Button>
                    </Box>
                  )}
                </Stack>
              ) : (
                <GigAvailabilityPanel
                  eventDate={form.event_date}
                  onDataLoad={mode === 'create' ? setAvailabilityData : undefined}
                />
              )}
            </Grid>

            {/* Tasks — edit mode only */}
            {mode === 'edit' && (
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                  Tasks
                </Typography>
                <GigTasks gigId={gigId} initialTasks={initialTasks} members={members} />
              </Grid>
            )}

            {/* Notes — edit mode only */}
            {mode === 'edit' && (
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <TextField
                  label="Notes"
                  fullWidth
                  multiline
                  minRows={3}
                  value={form.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                />
              </Grid>
            )}
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
