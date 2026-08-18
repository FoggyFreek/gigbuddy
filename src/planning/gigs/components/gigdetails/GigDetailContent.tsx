import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import ChecklistIcon from '@mui/icons-material/Checklist'
import DeleteIcon from '@mui/icons-material/Delete'
import FestivalIcon from '@mui/icons-material/Festival'
import HandshakeIcon from '@mui/icons-material/Handshake'
import ImageIcon from '@mui/icons-material/Image'
import PeopleIcon from '@mui/icons-material/People'
import type { SvgIconComponent } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import FloatingTabs from '../../../../components/FloatingTabs.tsx'
import GigStatusIcon from '../GigStatusIcon.tsx'
import GigTagEditor from './GigTagEditor.tsx'
import ImageCropDialog from '../../../../components/ImageCropDialog.tsx'
import PlanningReadOnlyAlert from '../../../../components/PlanningReadOnlyAlert.tsx'
import { SourceTenantSwitch } from '../../../../components/SourceTenantIdentity.tsx'
import MyBandSelect from '../../../../people/my-bands/components/MyBandSelect.tsx'
import GigAvailability from './GigAvailability.tsx'
import GigEventDetails from './GigEventDetails.tsx'
import GigTasksSection from './GigTasksSection.tsx'
import GigTerms from './GigTerms.tsx'
import type { GigDetail, GigDetailForm, GigDetailTabKey } from './types.ts'
import useDebouncedSave from '../../../../hooks/useDebouncedSave.ts'
import { useCrossTenantRow } from '../../../shared/useCrossTenantRow.ts'
import { usePlanningSource } from '../../../shared/usePlanningSource.ts'
import { useTenantKind } from '../../../../hooks/useTenantKind.ts'
import { TENANT_CAPABILITIES } from '../../../../auth/tenantCapabilities.ts'
import { useAuth } from '../../../../contexts/authContext.ts'
import { addGigParticipant, deleteGigBanner, removeGigParticipant, setGigVote, updateGig, uploadGigBanner } from '../../gigs.ts'
import { getBannerPath } from '../../../../people/profiles/profile.ts'
import { setMyTaskDone } from '../../../availability/me.ts'
import { listMembers } from '../../../../people/memberships/bandMembers.ts'
import { compressBanner } from '../../../../utils/compressImage.ts'
import { toDateInput, toTimeInput } from '../../../events/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../../../../utils/requiredFields.ts'
import type { AvailabilitySummary, Id, GigEquipmentEntry, GigTag, Member, Venue, Task } from '../../../../types/entities.ts'
import { resolveEventEndDate } from '../../../../../shared/eventTimes.js'

const REQUIRED_FIELDS = ['event_date', 'event_description']

export type TabKey = GigDetailTabKey

// The detail body is split across four tabs, selected from the floating pill
// that overlaps the banner. Panels stay mounted (toggled via `display`) so
// auto-saving children (tasks/attachments) and form state survive tab switches.
const TABS: { key: TabKey; Icon: SvgIconComponent }[] = [
  { key: 'event', Icon: FestivalIcon },
  { key: 'terms', Icon: HandshakeIcon },
  { key: 'participants', Icon: PeopleIcon },
  { key: 'tasks', Icon: ChecklistIcon },
]

export interface GigDetailHandle {
  flush: () => Promise<void>
  saveStatus: string
}

interface GigDetailContentProps {
  gigId: Id
  onBannerUpdate?: (gigId: Id, patch: Record<string, unknown>) => void
  onGigLoaded?: (gig: GigDetail) => void
  onGigLoadError?: () => void
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

const GigDetailContent = forwardRef<GigDetailHandle, GigDetailContentProps>(function GigDetailContent({ gigId, onBannerUpdate, onGigLoaded, onGigLoadError, canWrite = true, initialTab = 'event' }, ref) {
  const { t } = useTranslation(['gigs', 'common'])
  const { user } = useAuth()
  // A personal workspace reads through the cross-tenant hub, so gigs from the
  // musician's other bands resolve at all. Those arrive labelled with their
  // band, which is what makes them read-only (useCrossTenantRow) and drops the
  // Terms and Participants tabs, band-scoped and unreachable from here.
  const source = usePlanningSource('gigs')
  const currentBandMemberId = user?.bandMemberId ?? null
  const [form, setForm] = useState<GigDetailForm>({
    event_date: '',
    end_date: '',
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
  })
  const [loading, setLoading] = useState(true)
  const [initialTasks, setInitialTasks] = useState<Task[]>([])
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [selectedFestival, setSelectedFestival] = useState<Venue | null>(null)
  const [gig, setGig] = useState<GigDetail | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [bannerPath, setBannerPath] = useState<string | null>(null)
  const [tags, setTags] = useState<GigTag[]>([])
  const [equipment, setEquipment] = useState<GigEquipmentEntry[]>([])
  const [bandBannerPath, setBandBannerPath] = useState<string | null>(null)
  const [bannerBusy, setBannerBusy] = useState(false)
  const [bannerError, setBannerError] = useState<string | null>(null)
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
    setTags(g.tags || [])
    setEquipment(g.equipment || [])
    setSelectedVenue(g.venue || null)
    setSelectedFestival(g.festival || null)
    setForm({
      event_date: toDateInput(g.event_date instanceof Date ? g.event_date.toISOString().slice(0, 10) : g.event_date),
      end_date: toDateInput(g.end_date),
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
    })
    setInitialTasks((g.tasks as Task[]) || [])
  }, [onGigLoaded])

  const refresh = useCallback(async () => {
    const g = await source.api.detail(gigId)
    applyGig(g)
    return g
  }, [gigId, applyGig, source])

  // The split view swaps `gigId` under a mounted pane, so between that render
  // and the arriving row the one in state is still the previous gig's. Derived
  // here rather than left to the fetch effect's setLoading, which lands a
  // commit later — after the panels below have already fetched for the new id.
  const rowIsStale = gig != null && gig.id !== gigId
  // A gig the personal workspace doesn't own: served read-only by /api/me, with
  // no band roster, availability, contacts, merch or invoices reachable.
  const { isCrossBand, canWrite: editable } = useCrossTenantRow(rowIsStale ? null : gig, { canWrite })
  // Who owns the gig is unknown until its own row arrives, and unknown is not
  // ours: the band-only panels each read a tenant-scoped sub-resource that 404s
  // for a gig the active tenant doesn't have.
  const ownRow = !rowIsStale && gig != null && !isCrossBand
  // Band-wide availability is scoped to the active tenant's roster, so it means
  // nothing for a foreign band's gig, and /api/availability 403s a personal
  // workspace outright — gate on both like the create-form panels do.
  const tenantKind = useTenantKind()
  const showAvailability = !isCrossBand && tenantKind.supports(TENANT_CAPABILITIES.BAND_AVAILABILITY)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    getBannerPath().then(setBandBannerPath).catch(() => {})
    source.api.detail(gigId, { signal: ac.signal })
      .then(applyGig)
      .catch((err: Error) => { if (!ac.signal.aborted) { console.error(err); onGigLoadError?.() } })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [gigId, applyGig, onGigLoadError, source])

  // The roster is the active tenant's, so it only means anything for a gig that
  // tenant owns — hence the wait for the gig rather than a fetch on mount. A
  // Personal events already carry their fixed participant; there is no roster to load.
  useEffect(() => {
    if (gig == null || isCrossBand || !source.canLoadRoster) return
    listMembers().then(setMembers).catch(() => {})
  }, [gig, isCrossBand, source])

  const participantIds = useMemo(
    () => new Set((gig?.participants ?? []).map((p) => p.band_member_id)),
    [gig]
  )
  const candidateMembers = members.filter((m) => !participantIds.has(m.id))

  const handleAvailabilityChange = useCallback((availability: AvailabilitySummary | null) => {
    onBannerUpdate?.(gigId, { members_availability: availability?.members ?? [] })
  }, [gigId, onBannerUpdate])

  async function handleVote(memberId: Id, vote: string | null) {
    await setGigVote(gigId, memberId, vote ?? '')
    await refresh()
  }

  async function handleRemoveParticipant(memberId: Id) {
    await removeGigParticipant(gigId, memberId)
    await refresh()
  }

  async function handleAddParticipant(memberId: Id) {
    await addGigParticipant(gigId, Number(memberId))
    await refresh()
  }

  // Which of the artist's bands this gig was for. Saved on the spot rather than
  // debounced — a picker has no half-typed state to wait for — but the pending
  // field edits are flushed first so the re-read below can't undo them.
  async function handleMyBandChange(myBandId: Id | null) {
    if (!editable) return
    await flush()
    const patch: Record<string, unknown> = { my_band_id: myBandId }
    await updateGig(gigId, patch)
    const updated = await refresh()
    onBannerUpdate?.(gigId, { my_band: updated.my_band ?? null })
  }

  // The only write a cross-band viewer gets: ticking their own assigned task.
  // /api/gigs is out of reach, so it goes through the hub instead.
  async function completeOwnTaskCrossBand(task: Task, done: boolean): Promise<Task> {
    if (task.id == null) return task
    return setMyTaskDone(task.id, done)
  }

  function handleTaskUpsert(task: Task) {
    setInitialTasks((current) => {
      if (task.id == null || !current.some((item) => item.id === task.id)) return [...current, task]
      return current.map((item) => item.id === task.id ? task : item)
    })
  }

  function handleTaskDelete(taskId: Id) {
    setInitialTasks((current) => current.filter((task) => task.id !== taskId))
  }

  function handleChange(field: string, value: unknown) {
    if (!editable) return
    if (field === 'admission' && value === 'free') {
      setForm((prev) => ({ ...prev, admission: 'free', ticket_link: '', percentage_of_sales: '' }))
      if (hasRequiredErrors(form, REQUIRED_FIELDS)) return
      schedule({ admission: 'free', ticket_link: null, percentage_of_sales: null })
      return
    }
    const patch: Record<string, unknown> = { [field]: value }
    const candidate = { ...form, ...patch }
    if (['event_date', 'start_time', 'end_time'].includes(field)) {
      patch.end_date = resolveEventEndDate(
        candidate.event_date as string,
        candidate.event_date as string,
        candidate.start_time as string,
        candidate.end_time as string,
      ) || null
    }
    const nextForm = { ...form, ...patch }
    setForm(nextForm as GigDetailForm)
    if (hasRequiredErrors(nextForm, REQUIRED_FIELDS)) return
    if (field === 'booking_fee') {
      patch.booking_fee_cents = feeToCents(value as string)
      delete patch.booking_fee
    }
    if (field === 'merchandise_cut' || field === 'percentage_of_sales') {
      patch[field] = pctToValue(value as string)
    }
    schedule(patch)
  }

  function handleBannerFileChange(e: ChangeEvent<HTMLInputElement>) {
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

  if (loading || rowIsStale) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const requiredErrors = getRequiredErrors(form, REQUIRED_FIELDS)
  const visibleTabs = ownRow ? TABS : TABS.filter(({ key }) => key === 'event' || key === 'tasks')
  const openTaskCount = initialTasks.filter((task) => !task.done).length
  // Derived, not synced: an initialTab (or a stale selection) pointing at a tab
  // this gig doesn't have falls back to the event tab without a render-phase set.
  const shownTab = visibleTabs.some(({ key }) => key === activeTab) ? activeTab : 'event'

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
            data-testid="band-banner"
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

        <GigTagEditor
          gigId={gigId}
          tags={tags}
          canWrite={editable}
          onChange={(nextTags) => {
            setTags(nextTags)
            setGig((current) => current ? { ...current, tags: nextTags } : current)
            onBannerUpdate?.(gigId, { tags: nextTags })
          }}
        />

        {/* Event banner centered, or placeholder when unset. The bottom inset
            reserves the strip the tab pill overlaps so it never covers the
            event banner. Cross-band the source band takes this slot: the gig
            banner is stripped from the payload, so there is nothing to show
            here and nothing to add. */}
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
          {isCrossBand ? (
            <SourceTenantSwitch
              tenantId={gig?.tenantId}
              tenantName={gig?.tenantName}
              tenantAvatarPath={gig?.tenantAvatarPath}
              size={96}
              sx={{ mb: 0, color: 'common.white', textShadow: '0 1px 4px #000' }}
            />
          ) : bannerPath ? (
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
        {editable && (
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
      <FloatingTabs
        tabs={visibleTabs.map(({ key, Icon }) => ({
          key,
          Icon,
          label: t($ => $.detail.tabs[key]),
          badgeCount: key === 'tasks' ? openTaskCount : 0,
        }))}
        value={shownTab}
        onChange={setActiveTab}
      />

      {/* ── Event ──────────────────────────────────────────────────────── */}
      <PlanningReadOnlyAlert canWrite={editable} />

      <Box sx={{ display: shownTab === 'event' ? 'block' : 'none' }}>
        {/* The band a gig was played with, where a gigbuddy band's gig shows the
            band switcher. A band profile is no tenant to switch into, so it sits
            at the top of the Event tab instead of in the banner. */}
        {ownRow && (
          <MyBandSelect
            withAvatar
            value={gig?.my_band?.id ?? null}
            onChange={handleMyBandChange}
            disabled={!editable}
          />
        )}
        <GigEventDetails
          active={shownTab === 'event'}
          editable={editable}
          form={form}
          requiredErrors={requiredErrors}
          selectedVenue={selectedVenue}
          selectedFestival={selectedFestival}
          hideVenueOpenAction={isCrossBand}
          onChange={handleChange}
          onVenueChange={(venue) => {
            setSelectedVenue(venue)
            handleChange('venue_id', venue?.id ?? null)
          }}
          onFestivalChange={(festival) => {
            setSelectedFestival(festival)
            handleChange('festival_id', festival?.id ?? null)
          }}
        />
      </Box>

      {ownRow && (
        <GigTerms
          active={shownTab === 'terms'}
          editable={editable}
          gigId={gigId}
          gigLoaded={ownRow}
          form={form}
          selectedVenue={selectedVenue}
          selectedFestival={selectedFestival}
          equipment={equipment}
          onChange={handleChange}
          onEquipmentChange={setEquipment}
        />
      )}

      {ownRow && (
        <GigAvailability
          active={shownTab === 'participants'}
          editable={editable}
          gigId={gigId}
          showAvailability={showAvailability}
          eventDate={form.event_date}
          endDate={form.end_date}
          eventStatus={form.status}
          startTime={form.start_time}
          endTime={form.end_time}
          participants={gig?.participants ?? []}
          candidateMembers={candidateMembers}
          venueId={selectedVenue?.id}
          festivalId={selectedFestival?.id}
          flush={flush}
          onAddParticipant={handleAddParticipant}
          onRemoveParticipant={handleRemoveParticipant}
          onVote={handleVote}
          onAvailabilityChange={handleAvailabilityChange}
        />
      )}

      <GigTasksSection
        active={shownTab === 'tasks'}
        editable={editable}
        gigId={gigId}
        initialTasks={initialTasks}
        initialAttachments={gig?.attachments ?? []}
        members={members}
        notes={form.notes}
        currentBandMemberId={isCrossBand ? (gig?.viewerBandMemberId ?? null) : currentBandMemberId}
        plainTextAttachments={isCrossBand}
        onChangeNotes={(notes) => handleChange('notes', notes)}
        onToggleTask={isCrossBand ? completeOwnTaskCrossBand : undefined}
        onTaskUpsert={handleTaskUpsert}
        onTaskDelete={handleTaskDelete}
      />
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
