import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import {
  addBandEventParticipant,
  deleteBandEvent,
  removeBandEventParticipant,
  updateBandEvent,
} from './bandEvents.ts'
import { listMembers } from '../../people/memberships/bandMembers.ts'
import type { BandEvent, Id, Member } from '../../types/entities.ts'
import type { MaybeCrossTenant } from '../../types/api.ts'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { toDateInput } from './eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../../utils/requiredFields.ts'
import BandEventFields from './components/BandEventFields.tsx'
import BandEventAvailabilitySection from './components/BandEventAvailabilitySection.tsx'
import MyBandSelect from '../../people/my-bands/components/MyBandSelect.tsx'
import PastEventAlert from '../../components/PastEventAlert.tsx'
import SaveStatusLabel from '../../components/SaveStatusLabel.tsx'
import { useCrossTenantRow } from '../shared/useCrossTenantRow.ts'
import PlanningReadOnlyAlert from '../../components/PlanningReadOnlyAlert.tsx'
import { usePlanningSource } from '../shared/usePlanningSource.ts'
import { SourceTenantSwitch } from '../../components/SourceTenantIdentity.tsx'

const REQUIRED_FIELDS = ['title', 'start_date']

// Read through `/api/me/band-events/:id` when opened on another band's event,
// so the band label fields may be present.
interface BandEventDetail extends MaybeCrossTenant<BandEvent> {
  start_time?: string
  end_time?: string
  notes?: string
}

interface BandEventForm {
  [key: string]: unknown
  title: string
  start_date: string
  end_date: string
  start_time: string
  end_time: string
  location: string
  notes: string
}

export default function BandEventDetailPage() {
  const { t } = useTranslation(['bandEvents', 'common'])
  const { id } = useParams()
  const bandEventId = Number(id)
  const source = usePlanningSource('bandEvents')
  const navigate = useNavigate()
  const outletCtx = (useOutletContext() || {}) as Record<string, unknown>
  const insideSplitView = !!outletCtx.insideSplitView
  const onBandEventDetailLoaded = outletCtx.onBandEventDetailLoaded as ((event: BandEvent) => void) | undefined
  const onBandEventDetailLoadError = outletCtx.onBandEventDetailLoadError as (() => void) | undefined

  const [form, setForm] = useState<BandEventForm>({
    title: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    location: '',
    notes: '',
  })
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Derived server-side from the event's date span, so it is reloaded whenever
  // those dates change. Absent in a personal workspace.
  const [availability, setAvailability] = useState<Pick<BandEvent, 'members_availability' | 'availability_days'>>({})
  const [members, setMembers] = useState<Member[]>([])
  const [event, setEvent] = useState<BandEventDetail | null>(null)
  const { isCrossBand, canWrite: detailCanWrite } = useCrossTenantRow(event)

  const setEventAvailability = useCallback((event: BandEvent) => {
    setAvailability({
      members_availability: event.members_availability,
      availability_days: event.availability_days,
    })
  }, [])

  const refreshAvailability = useCallback(async () => {
    const updatedEvent = await source.api.detail(bandEventId)
    setEventAvailability(updatedEvent)
    return updatedEvent
  }, [bandEventId, setEventAvailability, source])

  const saveFn = useCallback(
    async (patch: Partial<BandEventForm>) => { await updateBandEvent(bandEventId, patch) },
    [bandEventId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(
    saveFn,
    600,
    (patch) => {
      if (typeof outletCtx.onBandEventUpdate === 'function') {
        outletCtx.onBandEventUpdate(bandEventId, patch)
      }
      // The span moved, so the worst-day summary no longer describes it.
      if ('start_date' in patch || 'end_date' in patch || 'start_time' in patch || 'end_time' in patch) {
        refreshAvailability().catch(() => {})
      }
    }
  )

  useEffect(() => {
    source.api.detail(bandEventId)
      .then((ev) => {
        const detail = ev as BandEventDetail
        setEvent(detail)
        onBandEventDetailLoaded?.(detail)
        setForm({
          title: detail.title || '',
          start_date: toDateInput(detail.start_date),
          end_date: toDateInput(detail.end_date),
          start_time: detail.start_time ? String(detail.start_time).slice(0, 5) : '',
          end_time: detail.end_time ? String(detail.end_time).slice(0, 5) : '',
          location: detail.location || '',
          notes: detail.notes || '',
        })
        setEventAvailability(detail)
      })
      .catch(() => onBandEventDetailLoadError?.())
      .finally(() => setLoading(false))
  }, [bandEventId, onBandEventDetailLoaded, onBandEventDetailLoadError, setEventAvailability, source])

  useEffect(() => {
    if (source.canLoadRoster) listMembers().then(setMembers).catch(() => {})
  }, [source])

  function handleChange(field: string, value: string | boolean | null) {
    if (!detailCanWrite) return
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
    schedule({ [field]: value || null })
  }

  async function handleBack() {
    await flush()
    if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
    else navigate(-1)
  }

  // Which of the artist's bands this event was for. Saved on the spot rather than
  // debounced — a picker has no half-typed state to wait for — but the pending
  // field edits are flushed first so the re-read can't undo them.
  async function handleMyBandChange(myBandId: Id | null) {
    if (!detailCanWrite) return
    await flush()
    const patch: Record<string, unknown> = { my_band_id: myBandId }
    await updateBandEvent(bandEventId, patch)
    const updated = await source.api.detail(bandEventId) as BandEventDetail
    setEvent(updated)
    if (typeof outletCtx.onBandEventUpdate === 'function') {
      outletCtx.onBandEventUpdate(bandEventId, { my_band: updated.my_band ?? null })
    }
  }

  async function handleAddMember(memberId: Id) {
    const updatedEvent = await addBandEventParticipant(bandEventId, memberId)
    setEventAvailability(updatedEvent)
    if (typeof outletCtx.onBandEventUpdate === 'function') {
      outletCtx.onBandEventUpdate(bandEventId, {
        members_availability: updatedEvent.members_availability,
      })
    }
  }

  async function handleRemoveMember(memberId: Id) {
    await removeBandEventParticipant(bandEventId, memberId)
    const updatedEvent = await refreshAvailability()
    if (typeof outletCtx.onBandEventUpdate === 'function') {
      outletCtx.onBandEventUpdate(bandEventId, {
        members_availability: updatedEvent.members_availability,
      })
    }
  }

  const selectedMemberIds = new Set(availability.members_availability?.map((member) => member.member_id))
  const candidateMembers = members.filter((member) => member.id !== undefined && !selectedMemberIds.has(member.id))

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label={t($ => $.aria.back, { ns: 'common' })}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>{t($ => $.page.title)}</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={handleBack} aria-label={t($ => $.aria.close, { ns: 'common' })}>
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      {isCrossBand && event && (
        <SourceTenantSwitch
          tenantId={event.tenantId}
          tenantName={event.tenantName}
          tenantAvatarPath={event.tenantAvatarPath}
        />
      )}

      {/* The band a personal workspace's event was for takes the same slot: a band
          profile is no tenant to switch into, so it gets a picker instead. */}
      {!isCrossBand && event && (
        <MyBandSelect
          withAvatar
          value={event.my_band?.id ?? null}
          onChange={handleMyBandChange}
          disabled={!detailCanWrite}
        />
      )}

      {!loading && <PastEventAlert date={form.end_date || form.start_date} />}
      <PlanningReadOnlyAlert canWrite={detailCanWrite} />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <BandEventFields
            form={form}
            onChange={handleChange}
            errors={{ ...getRequiredErrors(form, REQUIRED_FIELDS), ...errors }}
            readOnly={!detailCanWrite}
          />
        </Grid>
      )}

      {!loading && availability.members_availability && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.availability.title)}
          </Typography>
          <BandEventAvailabilitySection
            members={availability.members_availability}
            days={availability.availability_days}
            candidateMembers={candidateMembers}
            canWrite={detailCanWrite}
            onAddMember={handleAddMember}
            onRemoveMember={handleRemoveMember}
          />
        </Box>
      )}

      {detailCanWrite && (
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
          <SaveStatusLabel status={saveStatus} />
        </Box>
      )}

      {detailCanWrite && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => setConfirmDelete(true)}>
            {t($ => $.actions.delete, { ns: 'common' })}
          </Button>
        </Box>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t($ => $.page.deleteConfirmTitle)}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t($ => $.confirmation.cannotUndo, { ns: 'common' })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              setConfirmDelete(false)
              await deleteBandEvent(bandEventId)
              if (typeof outletCtx.onBandEventDelete === 'function') outletCtx.onBandEventDelete(bandEventId)
              if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
              else navigate(-1)
            }}
          >
            {t($ => $.actions.delete, { ns: 'common' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
