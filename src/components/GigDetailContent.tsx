import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
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
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import DateEntryField from './DateEntryField.tsx'
import GigAttachments from './GigAttachments.tsx'
import GigTasks from './GigTasks.tsx'
import GigAvailabilityPanel from './GigAvailabilityPanel.tsx'
import GigParticipantsSection from './GigParticipantsSection.tsx'
import GigContactsSection from './GigContactsSection.tsx'
import ImageCropDialog from './ImageCropDialog.tsx'
import _VenuePickerRaw from './VenuePicker.tsx'
interface VenuePickerProps {
  categoryFilter?: string
  value?: Venue | null
  onChange?: (v: Venue | null) => void
  onSelect?: (v: Venue) => void
  excludeIds?: (Id | undefined)[]
  disabled?: boolean
  label?: string
}
const VenuePicker = _VenuePickerRaw as React.ComponentType<VenuePickerProps>
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { useAuth } from '../contexts/authContext.ts'
import { addGigParticipant, deleteGigBanner, getGig, removeGigParticipant, setGigVote, updateGig, uploadGigBanner } from '../api/gigs.ts'
import { listMembers } from '../api/bandMembers.ts'
import { compressBanner } from '../utils/compressImage.ts'
import { dayjsToTimeString, timeStringToDayjs, toDateInput, toTimeInput } from '../utils/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import type { Id, Gig, Participant, PurchaseAttachment, Member, Venue } from '../types/entities.ts'

const REQUIRED_FIELDS = ['event_date', 'event_description']

dayjs.extend(customParseFormat)

const STATUSES = ['option', 'confirmed', 'announced']

interface LocalGigTask {
  id?: Id
  title?: string
  done?: boolean
  due_date?: string | null
  assigned_to?: Id | null
}

interface GigDetail extends Gig {
  event_link?: string
  booking_fee_cents?: number
  admission?: string
  ticket_link?: string
  notes?: string
  has_pa_system?: boolean
  has_drumkit?: boolean
  has_stage_lights?: boolean
  tasks?: LocalGigTask[]
  attachments?: PurchaseAttachment[]
  participants?: Participant[]
}

interface GigForm {
  [key: string]: unknown
  event_date: string
  event_description: string
  venue_id: Id | null
  festival_id: Id | null
  event_link: string
  start_time: string
  end_time: string
  status: string
  booking_fee: string
  admission: string
  ticket_link: string
  notes: string
  has_pa_system: boolean
  has_drumkit: boolean
  has_stage_lights: boolean
}

export interface GigDetailHandle {
  flush: () => Promise<void>
  saveStatus: string
}

interface GigDetailContentProps {
  gigId: Id
  onBannerUpdate?: (gigId: Id, patch: Record<string, unknown>) => void
  onGigLoaded?: (gig: GigDetail) => void
  // Readers (no planning.write) see the gig read-only: fields disabled, no
  // banner/participant/contact/attachment/task-edit affordances. They keep the
  // one self-action — ticking their own assigned task done (see GigTasks).
  canWrite?: boolean
}

function feeToDisplay(cents: number | null | undefined): string {
  if (cents == null || cents === 0 && cents !== 0) return ''
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}

function feeToCents(str: string): number | null {
  const n = Number.parseFloat(str)
  if (Number.isNaN(n)) return null
  return Math.round(n * 100)
}

const GigDetailContent = forwardRef<GigDetailHandle, GigDetailContentProps>(function GigDetailContent({ gigId, onBannerUpdate, onGigLoaded, canWrite = true }, ref) {
  const { user } = useAuth()
  const currentBandMemberId = user?.bandMemberId ?? null
  const [form, setForm] = useState<GigForm>({
    event_date: '',
    event_description: '',
    venue_id: null,
    festival_id: null,
    event_link: '',
    start_time: '',
    end_time: '',
    status: 'option',
    booking_fee: '',
    admission: 'free',
    ticket_link: '',
    notes: '',
    has_pa_system: false,
    has_drumkit: false,
    has_stage_lights: false,
  })
  const [loading, setLoading] = useState(true)
  const [initialTasks, setInitialTasks] = useState<LocalGigTask[]>([])
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [selectedFestival, setSelectedFestival] = useState<Venue | null>(null)
  const [gig, setGig] = useState<GigDetail | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [addMemberId, setAddMemberId] = useState<Id | ''>('')
  const [bannerPath, setBannerPath] = useState<string | null>(null)
  const [bannerBusy, setBannerBusy] = useState(false)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const bannerInputRef = useRef<HTMLInputElement | null>(null)

  const saveFn = useCallback(
    async (patch: Record<string, unknown>) => { await updateGig(gigId, patch) },
    [gigId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(
    saveFn,
    600,
    (patch) => onBannerUpdate?.(gigId, patch)
  )

  useImperativeHandle(ref, () => ({ flush, saveStatus }), [flush, saveStatus])

  const applyGig = useCallback((g: GigDetail) => {
    setGig(g)
    onGigLoaded?.(g)
    setBannerPath(g.banner_path || null)
    setSelectedVenue(g.venue || null)
    setSelectedFestival(g.festival || null)
    setForm({
      event_date: toDateInput(g.event_date instanceof Date ? g.event_date.toISOString().slice(0, 10) : g.event_date),
      event_description: g.event_description || '',
      venue_id: g.venue?.id ?? null,
      festival_id: g.festival?.id ?? null,
      event_link: g.event_link || '',
      start_time: toTimeInput(g.start_time),
      end_time: toTimeInput(g.end_time),
      status: g.status || 'option',
      booking_fee: feeToDisplay(g.booking_fee_cents),
      admission: g.admission ?? 'free',
      ticket_link: g.ticket_link ?? '',
      notes: g.notes || '',
      has_pa_system: !!g.has_pa_system,
      has_drumkit: !!g.has_drumkit,
      has_stage_lights: !!g.has_stage_lights,
    })
    setInitialTasks((g.tasks as LocalGigTask[]) || [])
  }, [onGigLoaded])

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
      .catch((err: Error) => { if (!ac.signal.aborted) console.error(err) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [gigId, applyGig])

  const participantIds = useMemo(
    () => new Set((gig?.participants ?? []).map((p) => p.band_member_id)),
    [gig]
  )
  const candidateMembers = members.filter((m) => !participantIds.has(m.id))

  async function handleVote(memberId: Id, vote: string | null) {
    await setGigVote(gigId, memberId, vote ?? '')
    await refresh()
  }

  async function handleRemoveParticipant(memberId: Id) {
    await removeGigParticipant(gigId, memberId)
    await refresh()
  }

  async function handleAddParticipant() {
    if (!addMemberId) return
    await addGigParticipant(gigId, Number(addMemberId))
    setAddMemberId('')
    await refresh()
  }

  function handleChange(field: string, value: unknown) {
    if (!canWrite) return
    if (field === 'admission' && value === 'free') {
      setForm((prev) => ({ ...prev, admission: 'free', ticket_link: '' }))
      if (hasRequiredErrors(form, REQUIRED_FIELDS)) return
      schedule({ admission: 'free', ticket_link: null })
      return
    }
    setForm((prev) => ({ ...prev, [field]: value }))
    if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
    const patch: Record<string, unknown> = { [field]: value }
    if (field === 'booking_fee') {
      patch.booking_fee_cents = feeToCents(value as string)
      delete patch.booking_fee
    }
    schedule(patch)
  }

  function handleBannerFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBannerError(null)
    const url = URL.createObjectURL(file)
    setCropImageSrc(url)
    setCropOpen(true)
  }

  async function handleCropConfirm(blob: Blob) {
    setCropOpen(false)
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc)
    setCropImageSrc(null)
    setBannerBusy(true)
    try {
      const blobAsFile = blob instanceof File ? blob : new File([blob], 'banner.png', { type: blob.type || 'image/png' })
      const compressed = await compressBanner(blobAsFile)
      const result = await uploadGigBanner(gigId, compressed)
      setBannerPath(result.banner_path ?? null)
      onBannerUpdate?.(gigId, { banner_path: result.banner_path })
    } catch (err) {
      setBannerError((err as Error).message || 'Banner upload failed')
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
      onBannerUpdate?.(gigId, { banner_path: null })
    } catch (err) {
      setBannerError((err as Error).message || 'Banner delete failed')
    } finally {
      setBannerBusy(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const requiredErrors = getRequiredErrors(form, REQUIRED_FIELDS)

  return (
    <>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 3 }}>
          <DateEntryField
            label="Date"
            fullWidth
            required
            disabled={!canWrite}
            value={form.event_date}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('event_date', e.target.value)}
            error={!!requiredErrors.event_date}
            helperText={requiredErrors.event_date}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TimePicker
            label="Start time"
            ampm={false}
            disabled={!canWrite}
            value={timeStringToDayjs(form.start_time)}
            onChange={(v) => handleChange('start_time', dayjsToTimeString(v))}
            slotProps={{ textField: { fullWidth: true } }}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TimePicker
            label="End time"
            ampm={false}
            disabled={!canWrite}
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
            disabled={!canWrite}
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
            required
            disabled={!canWrite}
            value={form.event_description}
            onChange={(e) => handleChange('event_description', e.target.value)}
            error={!!requiredErrors.event_description}
            helperText={requiredErrors.event_description}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <VenuePicker
            categoryFilter="festival"
            disabled={!canWrite}
            value={selectedFestival}
            onChange={(v: Venue | null) => {
              setSelectedFestival(v)
              handleChange('festival_id', v?.id ?? null)
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <VenuePicker
            categoryFilter="venue"
            disabled={!canWrite}
            value={selectedVenue}
            onChange={(v: Venue | null) => {
              setSelectedVenue(v)
              handleChange('venue_id', v?.id ?? null)
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Event link"
            type="url"
            fullWidth
            disabled={!canWrite}
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
        <Grid size={{ xs: 12 }}>
          <FormControlLabel
            control={
              <Switch
                checked={form.admission === 'paid'}
                disabled={!canWrite}
                onChange={(e) =>
                  handleChange('admission', e.target.checked ? 'paid' : 'free')
                }
              />
            }
            label="Paid admission"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Band fee"
            fullWidth
            disabled={!canWrite}
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
        {form.admission === 'paid' && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Ticket link"
              type="url"
              fullWidth
              disabled={!canWrite}
              value={form.ticket_link}
              onChange={(e) => handleChange('ticket_link', e.target.value)}
              slotProps={{
                input: {
                  endAdornment: form.ticket_link ? (
                    <InputAdornment position="end">
                      <Tooltip title="Open link">
                        <IconButton
                          size="small"
                          edge="end"
                          component="a"
                          href={form.ticket_link}
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
        )}

        {/* Contacts */}
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Contacts
          </Typography>
          <GigContactsSection
            gigId={gigId}
            venueId={selectedVenue?.id ?? undefined}
            festivalId={selectedFestival?.id ?? undefined}
            flush={flush}
            canWrite={canWrite}
          />
        </Grid>

        {/* Equipment */}
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Available equipment on-site
          </Typography>
          <FormGroup row>
            <FormControlLabel
              control={
                <Switch
                  checked={form.has_pa_system}
                  disabled={!canWrite}
                  onChange={(e) => handleChange('has_pa_system', e.target.checked)}
                />
              }
              label="PA system"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.has_drumkit}
                  disabled={!canWrite}
                  onChange={(e) => handleChange('has_drumkit', e.target.checked)}
                />
              }
              label="Drumkit"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.has_stage_lights}
                  disabled={!canWrite}
                  onChange={(e) => handleChange('has_stage_lights', e.target.checked)}
                />
              }
              label="Stage light"
            />
          </FormGroup>
        </Grid>

        {/* Availability / Participants */}
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
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
              canWrite={canWrite}
            />
          ) : (
            <GigAvailabilityPanel eventDate={form.event_date} />
          )}
        </Grid>

        {/* Tasks */}
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Tasks
          </Typography>
          <GigTasks key={String(gigId)} gigId={gigId} initialTasks={initialTasks} members={members} canWrite={canWrite} currentBandMemberId={currentBandMemberId} />
        </Grid>

        {/* Attachments */}
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Attachments
          </Typography>
          <GigAttachments key={String(gigId)} gigId={gigId} initialAttachments={gig?.attachments ?? []} canWrite={canWrite} />
        </Grid>

        {/* Notes */}
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <TextField
            label="Notes"
            fullWidth
            multiline
            minRows={3}
            disabled={!canWrite}
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
          />
        </Grid>

        {/* Event Banner */}
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
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
            {canWrite && (
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
            )}
          </Stack>
        </Grid>
      </Grid>

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
    </>
  )
})

export default GigDetailContent
