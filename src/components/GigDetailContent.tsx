import React, { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Skeleton from '@mui/material/Skeleton'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import ChecklistIcon from '@mui/icons-material/Checklist'
import DeleteIcon from '@mui/icons-material/Delete'
import FestivalIcon from '@mui/icons-material/Festival'
import HandshakeIcon from '@mui/icons-material/Handshake'
import ImageIcon from '@mui/icons-material/Image'
import LocalMallIcon from '@mui/icons-material/LocalMall'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PeopleIcon from '@mui/icons-material/People'
import type { SvgIconComponent } from '@mui/icons-material'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { useTranslation } from 'react-i18next'
import DateEntryField from './DateEntryField.tsx'
import GigAttachments from './GigAttachments.tsx'
import GigTasks from './GigTasks.tsx'
import GigAvailabilityPanel from './GigAvailabilityPanel.tsx'
import GigParticipantsSection from './GigParticipantsSection.tsx'
import GigContactsSection from './GigContactsSection.tsx'
import GigStatusIcon from './GigStatusIcon.tsx'
import ImageCropDialog from './ImageCropDialog.tsx'
import PlanningReadOnlyAlert from './PlanningReadOnlyAlert.tsx'
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
import { addGigParticipant, deleteGigBanner, getGig, getGigMerchSummary, removeGigParticipant, setGigVote, updateGig, uploadGigBanner } from '../api/gigs.ts'
import { getBannerPath } from '../api/profile.ts'
import { listMembers } from '../api/bandMembers.ts'
import { compressBanner } from '../utils/compressImage.ts'
import { geocodePlace } from '../utils/geocode.ts'
import { dayjsToTimeString, timeStringToDayjs, toDateInput, toTimeInput } from '../utils/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import type { Id, Gig, GigMerchSummary, Participant, PurchaseAttachment, Member, Venue, Task } from '../types/entities.ts'

const REQUIRED_FIELDS = ['event_date', 'event_description']

dayjs.extend(customParseFormat)

const STATUSES = ['option', 'confirmed', 'announced'] as const

// Lazy so Leaflet stays in its own chunk, off the gig-detail critical path.
const GigLocationMap = lazy(() => import('./map/GigLocationMap.tsx'))
const MAP_STREET_ZOOM = 16
const MAP_CITY_ZOOM = 11

export type TabKey = 'event' | 'terms' | 'availability' | 'tasks'

// The detail body is split across four tabs, selected from the floating pill
// that overlaps the banner. Panels stay mounted (toggled via `display`) so
// auto-saving children (tasks/attachments) and form state survive tab switches.
const TABS: { key: TabKey; Icon: SvgIconComponent }[] = [
  { key: 'event', Icon: FestivalIcon },
  { key: 'terms', Icon: HandshakeIcon },
  { key: 'availability', Icon: PeopleIcon },
  { key: 'tasks', Icon: ChecklistIcon },
]

interface GigDetail extends Gig {
  event_link?: string
  booking_fee_cents?: number
  admission?: string
  ticket_link?: string
  notes?: string
  has_pa_system?: boolean
  has_drumkit?: boolean
  has_stage_lights?: boolean
  tasks?: Task[]
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
  merchandise_cut: string
  percentage_of_sales: string
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
  // Tab to open on first mount (e.g. arriving from the tasks list → 'tasks').
  initialTab?: TabKey
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

// A percentage form field (merchandise cut / percentage of sales) → the value to
// send. Empty/blank clears the field (null); otherwise the parsed number.
function pctToValue(str: string): number | null {
  if (str.trim() === '') return null
  const n = Number.parseFloat(str)
  return Number.isNaN(n) ? null : n
}

// Hide the native browser up/down spin buttons on type="number" inputs.
const NO_NUMBER_SPINNER_SX = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
  '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
}

const GigDetailContent = forwardRef<GigDetailHandle, GigDetailContentProps>(function GigDetailContent({ gigId, onBannerUpdate, onGigLoaded, canWrite = true, initialTab = 'event' }, ref) {
  const { t } = useTranslation('gigs')
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
    merchandise_cut: '',
    percentage_of_sales: '',
    notes: '',
    has_pa_system: false,
    has_drumkit: false,
    has_stage_lights: false,
  })
  const [loading, setLoading] = useState(true)
  const [initialTasks, setInitialTasks] = useState<Task[]>([])
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [selectedFestival, setSelectedFestival] = useState<Venue | null>(null)
  const [mapCoords, setMapCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [gig, setGig] = useState<GigDetail | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [addMemberId, setAddMemberId] = useState<Id | ''>('')
  const [bannerPath, setBannerPath] = useState<string | null>(null)
  const [bandBannerPath, setBandBannerPath] = useState<string | null>(null)
  const [bannerBusy, setBannerBusy] = useState(false)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [merchSummary, setMerchSummary] = useState<GigMerchSummary | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
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
      merchandise_cut: g.merchandise_cut == null ? '' : String(g.merchandise_cut),
      percentage_of_sales: g.percentage_of_sales == null ? '' : String(g.percentage_of_sales),
      notes: g.notes || '',
      has_pa_system: !!g.has_pa_system,
      has_drumkit: !!g.has_drumkit,
      has_stage_lights: !!g.has_stage_lights,
    })
    setInitialTasks((g.tasks as Task[]) || [])
  }, [onGigLoaded])

  const refresh = useCallback(async () => {
    const g = await getGig(gigId)
    applyGig(g)
  }, [gigId, applyGig])

  // Location map: prefer the venue, fall back to the festival; city is the gate
  // (no city → no map). street_and_number, when present, sharpens to street
  // level. Recomputed only when the picked venue/festival changes.
  const mapSource = selectedVenue?.city ? selectedVenue : selectedFestival
  const mapPlace = useMemo(() => {
    if (!mapSource?.city) return null
    return {
      city: mapSource.city,
      region: mapSource.region || undefined,
      country: mapSource.country || undefined,
      postalCode: mapSource.postal_code || undefined,
      address: mapSource.street_and_number || undefined,
    }
  }, [mapSource])
  const mapZoom = mapPlace?.address ? MAP_STREET_ZOOM : MAP_CITY_ZOOM
  const mapLabel = mapSource?.name || ''
  const mapsHref = useMemo(() => {
    if (!mapCoords) return ''
    const query = [mapPlace?.address, mapPlace?.postalCode, mapPlace?.city, mapPlace?.country]
      .filter(Boolean)
      .join(', ') || `${mapCoords.lat},${mapCoords.lon}`
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  }, [mapCoords, mapPlace])

  useEffect(() => {
    // Clear synchronously so the previous venue's pin doesn't linger while the
    // next lookup is in flight.
    setMapCoords(null)
    if (!mapPlace) return
    let cancelled = false
    geocodePlace(mapPlace).then((coords) => {
      if (!cancelled) setMapCoords(coords)
    })
    return () => { cancelled = true }
  }, [mapPlace])

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    listMembers().then(setMembers).catch(() => {})
    getBannerPath().then(setBandBannerPath).catch(() => {})
    getGig(gigId, { signal: ac.signal })
      .then(applyGig)
      .catch((err: Error) => { if (!ac.signal.aborted) console.error(err) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [gigId, applyGig])

  // Merch-sold summary. Reader gate: this is finance-ish data the server only
  // serves to non-readers — and on this page `canWrite` is exactly
  // planning.write — so readers skip the request entirely (no card for them).
  useEffect(() => {
    if (!canWrite) { setMerchSummary(null); return }
    const ac = new AbortController()
    getGigMerchSummary(gigId, { signal: ac.signal })
      .then(setMerchSummary)
      .catch((err: Error) => { if (!ac.signal.aborted) console.error(err) })
    return () => ac.abort()
  }, [gigId, canWrite])

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
      setForm((prev) => ({ ...prev, admission: 'free', ticket_link: '', percentage_of_sales: '' }))
      if (hasRequiredErrors(form, REQUIRED_FIELDS)) return
      schedule({ admission: 'free', ticket_link: null, percentage_of_sales: null })
      return
    }
    setForm((prev) => ({ ...prev, [field]: value }))
    if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
    const patch: Record<string, unknown> = { [field]: value }
    if (field === 'booking_fee') {
      patch.booking_fee_cents = feeToCents(value as string)
      delete patch.booking_fee
    }
    if (field === 'merchandise_cut' || field === 'percentage_of_sales') {
      patch[field] = pctToValue(value as string)
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
      setBannerError((err as Error).message || t($ => $.detail.banner.uploadFailed))
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
      setBannerError((err as Error).message || t($ => $.detail.banner.deleteFailed))
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
      {/* ── Header: band banner background + event banner centered ──────── */}
      <Box sx={{ position: 'relative' }}>
      <Box
        sx={(theme) => ({
          position: 'relative',
          height: { xs: 220, sm: 300 },
          mb: 0,
          borderRadius: 1,
          overflow: 'hidden',
          // Gradient fallback when no band banner is set.
          ...(bandBannerPath
            ? {}
            : {
                background:
                  theme.palette.mode === 'dark'
                    ? `linear-gradient(160deg, ${alpha(theme.palette.primary.dark, 0.55)}, ${alpha(theme.palette.primary.main, 0.35)})`
                    : `linear-gradient(160deg, ${alpha(theme.palette.primary.dark, 0.82)}, ${alpha(theme.palette.primary.main, 0.65)})`,
              }),
        })}
      >
        {/* Band banner as a slightly blurred layer behind everything. The
            negative inset hides the soft, semi-transparent edges the blur
            would otherwise reveal inside the clipped box. */}
        {bandBannerPath && (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: -8,
              backgroundImage: `url(/api/files/${bandBannerPath})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center top',
              filter: 'blur(2px)',
            }}
          />
        )}

        {/* Bottom fade on the band banner: solid black at the very bottom,
            transparent at the 25% mark, darkening the banner into the page below. */}
        {bandBannerPath && (
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '55%',
              pointerEvents: 'none',
              background: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%)',
            }}
          />
        )}

        {/* Event banner centered, or placeholder when unset. The bottom inset
            reserves the strip the tab pill overlaps so it never covers the
            event banner. */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {bannerPath ? (
            <Box
              component="img"
              src={`/api/files/${bannerPath}`}
              alt={t($ => $.detail.banner.alt)}
              sx={{ maxWidth: '70%', maxHeight: '80%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.5,
                px: 3,
                py: 2,
                borderRadius: 1,
                border: '2px dashed',
                borderColor: 'rgba(255,255,255,0.6)',
                color: 'rgba(255,255,255,0.85)',
                bgcolor: 'rgba(0,0,0,0.25)',
              }}
            >
              <ImageIcon sx={{ fontSize: 36 }} />
              <Typography variant="caption">{t($ => $.detail.banner.none)}</Typography>
            </Box>
          )}
        </Box>

        {bannerBusy && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(0,0,0,0.4)',
            }}
          >
            <CircularProgress size={28} sx={{ color: '#fff' }} />
          </Box>
        )}

        {/* Edit controls */}
        {canWrite && (
          <Stack direction="row" spacing={1} sx={{ position: 'absolute', top: 8, right: 8 }}>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleBannerFileChange}
            />
            <Tooltip title={bannerPath ? t($ => $.detail.banner.change) : t($ => $.detail.banner.add)}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => bannerInputRef.current?.click()}
                  disabled={bannerBusy}
                  sx={{
                    bgcolor: 'rgba(0,0,0,0.5)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.72)' },
                    '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.5)' },
                  }}
                >
                  <AddPhotoAlternateIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            {bannerPath && (
              <Tooltip title={t($ => $.detail.banner.remove)}>
                <span>
                  <IconButton
                    size="small"
                    onClick={handleBannerDelete}
                    disabled={bannerBusy}
                    sx={{
                      bgcolor: 'rgba(0,0,0,0.5)',
                      color: '#fff',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.72)' },
                      '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.5)' },
                    }}
                  >
                    <DeleteIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
        )}
      </Box>

      {/* Current status icon, just below the banner on the left. */}
      <Box sx={{ position: 'absolute', left: 16, bottom: 0, transform: 'translateY(50%)', zIndex: 3 }}>
        <GigStatusIcon status={form.status} size={36} />
      </Box>
      </Box>

      {/* ── Floating tab pill: rounded box overlapping the banner by ~50% of
          its own height, splitting the detail body into four sections. ──── */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          justifyContent: 'center',
          mt: -3.25,
          mb: 3,
        }}
      >
        <Paper elevation={6} sx={{ display: 'inline-flex', gap: 0.5, p: 0.75, borderRadius: 999 }}>
          {TABS.map(({ key, Icon }) => {
            const selected = activeTab === key
            const label = t($ => $.detail.tabs[key])
            return (
              <Tooltip key={key} title={label}>
                <IconButton
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => setActiveTab(key)}
                  color={selected ? 'primary' : 'default'}
                  sx={{
                    bgcolor: selected ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                  }}
                >
                  <Icon />
                </IconButton>
              </Tooltip>
            )
          })}
        </Paper>
      </Box>

      {/* ── Event ──────────────────────────────────────────────────────── */}
      <PlanningReadOnlyAlert canWrite={canWrite} />

      <Box sx={{ display: activeTab === 'event' ? 'block' : 'none' }}>
        <Grid container spacing={2}>
          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.eventDetails)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <DateEntryField
              label={t($ => $.detail.date)}
              fullWidth
              required
              readOnly={!canWrite}
              value={form.event_date}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('event_date', e.target.value)}
              error={!!requiredErrors.event_date}
              helperText={requiredErrors.event_date}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TimePicker
              label={t($ => $.detail.startTime)}
              ampm={false}
              readOnly={!canWrite}
              value={timeStringToDayjs(form.start_time)}
              onChange={(v) => handleChange('start_time', dayjsToTimeString(v))}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TimePicker
              label={t($ => $.detail.endTime)}
              ampm={false}
              readOnly={!canWrite}
              value={timeStringToDayjs(form.end_time)}
              onChange={(v) => handleChange('end_time', dayjsToTimeString(v))}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              select
              label={t($ => $.detail.status)}
              fullWidth
              disabled={!canWrite}
              value={form.status}
              onChange={(e) => handleChange('status', e.target.value)}
            >
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>{t($ => $.status[s])}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t($ => $.detail.eventDescription)}
              fullWidth
              required
              value={form.event_description}
              onChange={(e) => handleChange('event_description', e.target.value)}
              error={!!requiredErrors.event_description}
              helperText={requiredErrors.event_description}
              slotProps={{ htmlInput: { readOnly: !canWrite } }}
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
              label={t($ => $.detail.eventLink)}
              type="url"
              fullWidth
              value={form.event_link}
              onChange={(e) => handleChange('event_link', e.target.value)}
              slotProps={{
                htmlInput: { readOnly: !canWrite },
                input: {
                  endAdornment: form.event_link ? (
                    <InputAdornment position="end">
                      <Tooltip title={t($ => $.detail.openLink)}>
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
          {/* Location map — only mount on the active Event tab (the panel stays
              mounted under display:none, so gating avoids initializing Leaflet
              while hidden). Full width, 150px. */}
          {activeTab === 'event' && mapCoords && (
            <Grid size={12}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t($ => $.detail.location)}
              </Typography>
              <Suspense fallback={<Skeleton variant="rounded" height={150} />}>
                <GigLocationMap
                  key={`${mapCoords.lat},${mapCoords.lon},${mapZoom}`}
                  lat={mapCoords.lat}
                  lon={mapCoords.lon}
                  zoom={mapZoom}
                  label={mapLabel}
                  openLabel={t($ => $.detail.openInMaps)}
                  mapsHref={mapsHref}
                />
              </Suspense>
            </Grid>
          )}
        </Grid>
      </Box>

      {/* ── Terms (incl. on-site equipment + merch sold) ───────────────── */}
      <Box sx={{ display: activeTab === 'terms' ? 'block' : 'none' }}>
        <Grid container spacing={2}>
          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.terms)}
            </Typography>
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
              label={t($ => $.detail.paidAdmission)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t($ => $.detail.guaranteedFee)}
              fullWidth
              value={form.booking_fee}
              onChange={(e) => handleChange('booking_fee', e.target.value)}
              placeholder="0.00"
              slotProps={{
                htmlInput: { readOnly: !canWrite },
                input: {
                  startAdornment: <InputAdornment position="start">€</InputAdornment>,
                },
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t($ => $.detail.merchandiseCut)}
              type="number"
              fullWidth
              value={form.merchandise_cut}
              onChange={(e) => handleChange('merchandise_cut', e.target.value)}
              placeholder="0"
              sx={NO_NUMBER_SPINNER_SX}
              slotProps={{
                htmlInput: { min: 0, max: 100, step: 0.5, readOnly: !canWrite },
                input: {
                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                },
              }}
            />
          </Grid>
          {form.admission === 'paid' && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t($ => $.detail.percentageOfNetSales)}
                type="number"
                fullWidth
                value={form.percentage_of_sales}
                onChange={(e) => handleChange('percentage_of_sales', e.target.value)}
                placeholder="0"
                sx={NO_NUMBER_SPINNER_SX}
                slotProps={{
                  htmlInput: { min: 0, max: 100, step: 0.5, readOnly: !canWrite },
                  input: {
                    endAdornment: <InputAdornment position="end">%</InputAdornment>,
                  },
                }}
              />
            </Grid>
          )}
          {form.admission === 'paid' && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t($ => $.detail.ticketLink)}
                type="url"
                fullWidth
                value={form.ticket_link}
                onChange={(e) => handleChange('ticket_link', e.target.value)}
                slotProps={{
                  htmlInput: { readOnly: !canWrite },
                  input: {
                    endAdornment: form.ticket_link ? (
                      <InputAdornment position="end">
                        <Tooltip title={t($ => $.detail.openLink)}>
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

          {/* Merch sold at this gig. Only rendered for non-readers (canWrite ==
              planning.write here) and only when there were sales. */}
          {canWrite && merchSummary && merchSummary.unitsSold > 0 && (
            <Grid size={12}>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <LocalMallIcon color="action" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                    {t($ => $.detail.merchandiseSold)}
                  </Typography>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                      {formatEur(merchSummary.netCents)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t($ => $.detail.itemsSold, { count: merchSummary.unitsSold })}
                    </Typography>
                  </Box>
                </Stack>
              </Card>
            </Grid>
          )}

          {/* Equipment */}
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.equipmentOnSite)}
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
                label={t($ => $.detail.paSystem)}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.has_drumkit}
                    disabled={!canWrite}
                    onChange={(e) => handleChange('has_drumkit', e.target.checked)}
                  />
                }
                label={t($ => $.detail.drumkit)}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.has_stage_lights}
                    disabled={!canWrite}
                    onChange={(e) => handleChange('has_stage_lights', e.target.checked)}
                  />
                }
                label={t($ => $.detail.stageLight)}
              />
            </FormGroup>
          </Grid>
        </Grid>
      </Box>

      {/* ── Availability (member availability + contacts) ──────────────── */}
      <Box sx={{ display: activeTab === 'availability' ? 'block' : 'none' }}>
        <Grid container spacing={2}>
          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.memberAvailability)}
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
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.contacts)}
            </Typography>
            <GigContactsSection
              gigId={gigId}
              venueId={selectedVenue?.id ?? undefined}
              festivalId={selectedFestival?.id ?? undefined}
              flush={flush}
              canWrite={canWrite}
            />
          </Grid>
        </Grid>
      </Box>

      {/* ── Tasks (todos, attachments, notes) ──────────────────────────── */}
      <Box sx={{ display: activeTab === 'tasks' ? 'block' : 'none' }}>
        <Grid container spacing={2}>
          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.tasks)}
            </Typography>
            <GigTasks key={String(gigId)} gigId={gigId} initialTasks={initialTasks} members={members} canWrite={canWrite} currentBandMemberId={currentBandMemberId} />
          </Grid>
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.attachments)}
            </Typography>
            <GigAttachments key={String(gigId)} gigId={gigId} initialAttachments={gig?.attachments ?? []} canWrite={canWrite} />
          </Grid>
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <TextField
              label={t($ => $.detail.notes)}
              fullWidth
              multiline
              minRows={3}
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              sx={{ my: 2 }}
              slotProps={{ htmlInput: { readOnly: !canWrite } }}
            />
          </Grid>
        </Grid>
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
    </>
  )
})

export default GigDetailContent
