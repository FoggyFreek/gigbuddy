import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import GigAttachments from '../components/GigAttachments.jsx'
import GigTasks from '../components/GigTasks.jsx'
import GigAvailabilityPanel from '../components/GigAvailabilityPanel.jsx'
import GigParticipantsSection from '../components/GigParticipantsSection.jsx'
import ImageCropDialog from '../components/ImageCropDialog.jsx'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { addGigParticipant, deleteGigBanner, getGig, removeGigParticipant, setGigVote, updateGig, uploadGigBanner } from '../api/gigs.js'
import { listMembers } from '../api/bandMembers.js'
import { compressBanner } from '../utils/compressImage.js'
import { dayjsToTimeString, timeStringToDayjs, toDateInput, toTimeInput } from '../utils/eventFormUtils.js'

dayjs.extend(customParseFormat)

const STATUSES = ['option', 'confirmed', 'announced']

function feeToDisplay(cents) {
  if (cents == null || cents === '') return ''
  return (cents / 100).toFixed(2)
}

function feeToCents(str) {
  const n = parseFloat(str)
  if (isNaN(n)) return null
  return Math.round(n * 100)
}

export default function GigDetailPage() {
  const { id } = useParams()
  const gigId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  const [form, setForm] = useState({
    event_date: '',
    event_description: '',
    venue: '',
    city: '',
    event_link: '',
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
    has_stage_lights: false,
  })
  const [loading, setLoading] = useState(true)
  const [initialTasks, setInitialTasks] = useState([])
  const [focused, setFocused] = useState({ event_date: false })
  const [gig, setGig] = useState(null)
  const [members, setMembers] = useState([])
  const [addMemberId, setAddMemberId] = useState('')
  const [emailCopied, setEmailCopied] = useState(false)
  const [bannerPath, setBannerPath] = useState(null)
  const [bannerBusy, setBannerBusy] = useState(false)
  const [bannerError, setBannerError] = useState(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState(null)
  const bannerInputRef = useRef(null)

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
    setBannerPath(g.banner_path || null)
    setForm({
      event_date: toDateInput(g.event_date),
      event_description: g.event_description || '',
      venue: g.venue || '',
      city: g.city || '',
      event_link: g.event_link || '',
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
      has_stage_lights: !!g.has_stage_lights,
    })
    setInitialTasks(g.tasks || [])
  }, [])

  const refresh = useCallback(async () => {
    const g = await getGig(gigId)
    applyGig(g)
  }, [gigId, applyGig])

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    listMembers().then(setMembers).catch(() => {})
    getGig(gigId, { signal: ac.signal })
      .then(applyGig)
      .catch((err) => { if (!ac.signal.aborted) console.error(err) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [gigId, applyGig])

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
    const patch = { [field]: value }
    if (field === 'booking_fee') {
      patch.booking_fee_cents = feeToCents(value)
      delete patch.booking_fee
    }
    schedule(patch)
  }

  function handleBannerFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBannerError(null)
    const url = URL.createObjectURL(file)
    setCropImageSrc(url)
    setCropOpen(true)
  }

  async function handleCropConfirm(blob) {
    setCropOpen(false)
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc)
    setCropImageSrc(null)
    setBannerBusy(true)
    try {
      const compressed = await compressBanner(blob)
      const result = await uploadGigBanner(gigId, compressed)
      setBannerPath(result.banner_path)
      outletCtx.onGigUpdate?.(gigId, { banner_path: result.banner_path })
    } catch (err) {
      setBannerError(err.message || 'Banner upload failed')
    } finally {
      setBannerBusy(false)
    }
  }

  function handleCropCancel() {
    setCropOpen(false)
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc)
    setCropImageSrc(null)
  }

  async function handleBannerDelete() {
    setBannerBusy(true)
    setBannerError(null)
    try {
      await deleteGigBanner(gigId)
      setBannerPath(null)
      outletCtx.onGigUpdate?.(gigId, { banner_path: null })
    } catch (err) {
      setBannerError(err.message || 'Banner delete failed')
    } finally {
      setBannerBusy(false)
    }
  }

  async function handleBack() {
    await flush()
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" fontWeight={600}>Gig details</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={handleBack} aria-label="close">
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              label="Date"
              type="date"
              fullWidth
              value={form.event_date}
              onChange={(e) => handleChange('event_date', e.target.value)}
              onFocus={onFocus('event_date')}
              onBlur={onBlur('event_date')}
              slotProps={{ inputLabel: { shrink: focused.event_date || !!form.event_date } }}
              sx={maskSx('event_date')}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TimePicker
              label="Start time"
              ampm={false}
              value={timeStringToDayjs(form.start_time)}
              onChange={(v) => handleChange('start_time', dayjsToTimeString(v))}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TimePicker
              label="End time"
              ampm={false}
              value={timeStringToDayjs(form.end_time)}
              onChange={(v) => handleChange('end_time', dayjsToTimeString(v))}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
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
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Event description"
              fullWidth
              value={form.event_description}
              onChange={(e) => handleChange('event_description', e.target.value)}
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
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Event link"
              type="url"
              fullWidth
              value={form.event_link}
              onChange={(e) => handleChange('event_link', e.target.value)}
              slotProps={{
                input: {
                  endAdornment: form.event_link ? (
                    <InputAdornment position="end">
                      <Tooltip title="Open link">
                        <IconButton
                          size="small"
                          edge="end"
                          component="a"
                          href={form.event_link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ) : null,
                },
              }}
            />
          </Grid>
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
            {form.status === 'option' ? (
              <GigParticipantsSection
                participants={gig?.participants ?? []}
                candidateMembers={candidateMembers}
                addMemberId={addMemberId}
                onAddMemberChange={setAddMemberId}
                onAddParticipant={handleAddParticipant}
                onRemoveParticipant={handleRemoveParticipant}
                onVote={handleVote}
              />
            ) : (
              <GigAvailabilityPanel eventDate={form.event_date} />
            )}
          </Grid>

          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Tasks
            </Typography>
            <GigTasks key={gigId} gigId={gigId} initialTasks={initialTasks} members={members} />
          </Grid>

          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Attachments
            </Typography>
            <GigAttachments key={gigId} gigId={gigId} initialAttachments={gig?.attachments ?? []} />
          </Grid>

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

          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Event banner
            </Typography>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              {bannerPath ? (
                <Box
                  component="img"
                  src={`/api/files/${bannerPath}`}
                  alt="Event banner"
                  sx={{
                    width: 120,
                    height: 120,
                    objectFit: 'contain',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'grey.100',
                  }}
                />
              ) : (
                <Box
                  sx={{
                    width: 120,
                    height: 120,
                    borderRadius: 1,
                    border: '2px dashed',
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'text.disabled',
                  }}
                >
                  <Typography variant="caption">No banner</Typography>
                </Box>
              )}
              <Stack spacing={1}>
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleBannerFileChange}
                />
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={bannerBusy ? <CircularProgress size={14} color="inherit" /> : <AddPhotoAlternateIcon />}
                  disabled={bannerBusy}
                  onClick={() => bannerInputRef.current?.click()}
                >
                  {bannerPath ? 'Replace' : 'Upload banner'}
                </Button>
                {bannerPath && (
                  <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteIcon />}
                    disabled={bannerBusy}
                    onClick={handleBannerDelete}
                  >
                    Remove
                  </Button>
                )}
              </Stack>
            </Stack>
          </Grid>
        </Grid>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
      </Box>

      <ImageCropDialog
        open={cropOpen}
        imageSrc={cropImageSrc}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
      <Snackbar
        open={!!bannerError}
        message={bannerError || ''}
        autoHideDuration={4000}
        onClose={() => setBannerError(null)}
      />
    </Box>
  )
}
