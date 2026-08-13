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
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { toDateInput, toTimeInput } from '../events/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../../utils/requiredFields.ts'
import { addParticipant, addSong, deleteRehearsal, removeParticipant, removeSong, setVote, updateRehearsal } from './rehearsals.ts'
import { listMembers } from '../../people/memberships/bandMembers.ts'
import RehearsalFields from './components/RehearsalFields.tsx'
import PastEventAlert from '../../components/PastEventAlert.tsx'
import RehearsalParticipantsSection from './components/RehearsalParticipantsSection.tsx'
import RehearsalSongsSection from './components/RehearsalSongsSection.tsx'
import MyBandSelect from '../../people/my-bands/components/MyBandSelect.tsx'
import SaveStatusLabel from '../../components/SaveStatusLabel.tsx'
import PlanningReadOnlyAlert from '../../components/PlanningReadOnlyAlert.tsx'
import { useAuth } from '../../contexts/authContext.ts'
import { useCrossTenantRow } from '../shared/useCrossTenantRow.ts'
import type { Rehearsal, Member, Song, Id } from '../../types/entities.ts'
import type { MaybeCrossTenant } from '../../types/api.ts'
import { setMyRehearsalVote } from '../availability/me.ts'
import { useTenantKind } from '../../hooks/useTenantKind.ts'
import { usePlanningSource } from '../shared/usePlanningSource.ts'
import { SourceTenantSwitch } from '../../components/SourceTenantIdentity.tsx'
import { TENANT_CAPABILITIES } from '../../auth/tenantCapabilities.ts'
import { resolveEventEndDate } from '../../../shared/eventTimes.js'

interface RehearsalDetailOutletContext {
  insideSplitView?: boolean
  onClose?: () => void
  onRehearsalUpdate?: (id: Id, patch: Partial<Rehearsal>) => void
  onRehearsalDelete?: (id: Id) => void
  onRehearsalDetailLoaded?: (rehearsal: RehearsalDetail) => void
  onRehearsalDetailLoadError?: () => void
}

// Read through `/api/me/rehearsals/:id` when opened on another band's rehearsal,
// so the band label fields may be present.
type RehearsalDetail = MaybeCrossTenant<Rehearsal>

interface RehearsalForm {
  proposed_date: string
  end_date: string
  start_time: string
  end_time: string
  location: string
  notes: string
}

const REQUIRED_FIELDS = ['proposed_date']

export default function RehearsalDetailPage() {
  const { t } = useTranslation(['rehearsals', 'common'])
  const { id } = useParams()
  const rehearsalId = Number(id)
  const navigate = useNavigate()
  const { user } = useAuth()
  const tenantKind = useTenantKind()
  const source = usePlanningSource('rehearsals')
  const outletCtx = (useOutletContext<RehearsalDetailOutletContext>() || {}) as RehearsalDetailOutletContext
  const insideSplitView = !!outletCtx.insideSplitView
  const onRehearsalDetailLoaded = outletCtx.onRehearsalDetailLoaded
  const onRehearsalDetailLoadError = outletCtx.onRehearsalDetailLoadError

  const [form, setForm] = useState<RehearsalForm>({ proposed_date: '', end_date: '', start_time: '', end_time: '', location: '', notes: '' })
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rehearsal, setRehearsal] = useState<RehearsalDetail | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const { isCrossBand, canWrite: detailCanWrite } = useCrossTenantRow(rehearsal)

  const saveFn = useCallback(
    async (patch: Partial<RehearsalForm>) => { await updateRehearsal(rehearsalId, patch) },
    [rehearsalId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(
    saveFn,
    600,
    (patch) => outletCtx.onRehearsalUpdate?.(rehearsalId, patch)
  )

  useEffect(() => {
    if (source.canLoadRoster) listMembers().then(setMembers).catch(() => {})
  }, [source])

  const refresh = useCallback(async () => {
    const r = await source.api.detail(rehearsalId)
    setRehearsal(r)
    setForm({
      proposed_date: toDateInput(r.proposed_date),
      end_date: toDateInput(r.end_date),
      start_time: toTimeInput(r.start_time),
      end_time: toTimeInput(r.end_time),
      location: r.location || '',
      notes: r.notes || '',
    })
    return r
  }, [rehearsalId, source])

  useEffect(() => {
    source.api.detail(rehearsalId)
      .then((rehearsalData) => {
        setRehearsal(rehearsalData)
        onRehearsalDetailLoaded?.(rehearsalData)
        setForm({
          proposed_date: toDateInput(rehearsalData.proposed_date),
          end_date: toDateInput(rehearsalData.end_date),
          start_time: toTimeInput(rehearsalData.start_time),
          end_time: toTimeInput(rehearsalData.end_time),
          location: rehearsalData.location || '',
          notes: rehearsalData.notes || '',
        })
      })
      .catch(() => onRehearsalDetailLoadError?.())
      .finally(() => setLoading(false))
  }, [rehearsalId, onRehearsalDetailLoaded, onRehearsalDetailLoadError, source])

  function handleChange(field: string, value: string | null) {
    if (!detailCanWrite) return
    const patch: Partial<RehearsalForm> = { [field]: value ?? '' }
    const candidate = { ...form, ...patch }
    if (['proposed_date', 'start_time', 'end_time'].includes(field)) {
      patch.end_date = resolveEventEndDate(
        candidate.proposed_date,
        candidate.proposed_date,
        candidate.start_time,
        candidate.end_time,
      ) || ''
    }
    const nextForm = { ...form, ...patch }
    setForm(nextForm)
    if (hasRequiredErrors(nextForm as unknown as Record<string, unknown>, REQUIRED_FIELDS)) return
    schedule(Object.fromEntries(
      Object.entries(patch).map(([key, update]) => [key, update || null]),
    ) as Partial<RehearsalForm>)
  }

  async function handleVote(memberId: Id | undefined, vote: string | null) {
    if (memberId === undefined || vote === null) return
    if (isCrossBand) await setMyRehearsalVote(rehearsalId, vote)
    else await setVote(rehearsalId, memberId, vote)
    await refresh()
  }

  async function handleRemoveParticipant(memberId: Id | undefined) {
    if (memberId === undefined) return
    await removeParticipant(rehearsalId, memberId)
    await refresh()
  }

  async function handleAddParticipant(memberId: Id) {
    await addParticipant(rehearsalId, Number(memberId))
    await refresh()
  }

  // Which of the artist's bands this rehearsal was for. Saved on the spot rather
  // than debounced — a picker has no half-typed state to wait for — but the
  // pending field edits are flushed first so the re-read can't undo them.
  async function handleMyBandChange(myBandId: Id | null) {
    if (!detailCanWrite) return
    await flush()
    const patch: Record<string, unknown> = { my_band_id: myBandId }
    await updateRehearsal(rehearsalId, patch)
    const updated = await refresh()
    outletCtx.onRehearsalUpdate?.(rehearsalId, { my_band: updated.my_band ?? null })
  }

  async function handleAddSong(song: Song) {
    if (song.id === undefined) return
    const updated = await addSong(rehearsalId, song.id)
    setRehearsal((prev) => ({ ...prev, songs: (updated as Rehearsal).songs }))
  }

  async function handleRemoveSong(songId: Id | undefined) {
    if (songId === undefined) return
    await removeSong(rehearsalId, songId)
    setRehearsal((prev) => ({
      ...prev,
      songs: (prev?.songs ?? []).filter((s) => s.song_id !== songId),
    }))
  }

  async function handlePromote() {
    await flush()
    await updateRehearsal(rehearsalId, { status: 'planned' })
    outletCtx.onRehearsalUpdate?.(rehearsalId, { status: 'planned' })
    await refresh()
  }

  async function handleDemote() {
    await updateRehearsal(rehearsalId, { status: 'option' })
    outletCtx.onRehearsalUpdate?.(rehearsalId, { status: 'option' })
    await refresh()
  }

  async function handleBack() {
    await flush()
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

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

      {isCrossBand && rehearsal && (
        <SourceTenantSwitch
          tenantId={rehearsal.tenantId}
          tenantName={rehearsal.tenantName}
          tenantAvatarPath={rehearsal.tenantAvatarPath}
        />
      )}

      {/* The band a personal workspace's rehearsal was for takes the same slot: a
          band profile is no tenant to switch into, so it gets a picker instead. */}
      {!isCrossBand && rehearsal && (
        <MyBandSelect
          withAvatar
          value={rehearsal.my_band?.id ?? null}
          onChange={handleMyBandChange}
          disabled={!detailCanWrite}
        />
      )}

      {!loading && <PastEventAlert date={rehearsal?.proposed_date} />}
      <PlanningReadOnlyAlert canWrite={detailCanWrite} />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <RehearsalFields
            form={form}
            onChange={handleChange}
            errors={getRequiredErrors(form as unknown as Record<string, unknown>, REQUIRED_FIELDS)}
            readOnly={!detailCanWrite}
            dateTimeFirst
          />
          {rehearsal && (
            <>
              <RehearsalParticipantsSection
                rehearsal={rehearsal}
                members={members}
                onVote={handleVote}
                onRemoveParticipant={handleRemoveParticipant}
                onAddParticipant={handleAddParticipant}
                onPromote={handlePromote}
                onDemote={handleDemote}
                canWrite={detailCanWrite}
                currentMemberId={rehearsal.viewerBandMemberId ?? user?.bandMemberId ?? null}
                showAvailability={!isCrossBand && tenantKind.supports(TENANT_CAPABILITIES.BAND_AVAILABILITY)}
              />
              <RehearsalSongsSection
                songs={rehearsal.songs ?? []}
                onAddSong={handleAddSong}
                onRemoveSong={handleRemoveSong}
                canWrite={detailCanWrite}
                plainText={isCrossBand}
              />
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <TextField
                  label={t($ => $.form.notes)}
                  fullWidth
                  multiline
                  minRows={3}
                  value={form.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  slotProps={{ htmlInput: { readOnly: !detailCanWrite } }}
                />
              </Grid>
            </>
          )}
        </Grid>
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
              await deleteRehearsal(rehearsalId)
              outletCtx.onRehearsalDelete?.(rehearsalId)
              if (outletCtx.onClose) outletCtx.onClose()
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
