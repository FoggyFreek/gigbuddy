import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
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
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { toDateInput, toTimeInput } from '../utils/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import { addParticipant, addSong, deleteRehearsal, getRehearsal, removeParticipant, removeSong, setVote, updateRehearsal } from '../api/rehearsals.ts'
import { listMembers } from '../api/bandMembers.ts'
import RehearsalFields from '../components/RehearsalFields.tsx'
import PastEventAlert from '../components/PastEventAlert.tsx'
import RehearsalParticipantsSection from '../components/RehearsalParticipantsSection.tsx'
import RehearsalSongsSection from '../components/RehearsalSongsSection.tsx'
import SaveStatusLabel from '../components/SaveStatusLabel.tsx'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Rehearsal, Member, Song, Id } from '../types/entities.ts'

interface RehearsalDetailOutletContext {
  insideSplitView?: boolean
  onClose?: () => void
  onRehearsalUpdate?: (id: Id, patch: Partial<Rehearsal>) => void
  onRehearsalDelete?: (id: Id) => void
}

interface RehearsalForm {
  proposed_date: string
  start_time: string
  end_time: string
  location: string
  notes: string
}

const REQUIRED_FIELDS = ['proposed_date']

export default function RehearsalDetailPage() {
  const { id } = useParams()
  const rehearsalId = Number(id)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { canWritePlanning } = usePermissions()
  const outletCtx = (useOutletContext<RehearsalDetailOutletContext>() || {}) as RehearsalDetailOutletContext
  const insideSplitView = !!outletCtx.insideSplitView

  const [form, setForm] = useState<RehearsalForm>({ proposed_date: '', start_time: '', end_time: '', location: '', notes: '' })
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [addMemberId, setAddMemberId] = useState('')

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
    listMembers().then(setMembers).catch(() => {})
  }, [])

  const refresh = useCallback(async () => {
    const r = await getRehearsal(rehearsalId)
    setRehearsal(r as Rehearsal)
    setForm({
      proposed_date: toDateInput((r as Rehearsal).proposed_date),
      start_time: toTimeInput((r as Rehearsal).start_time),
      end_time: toTimeInput((r as Rehearsal).end_time),
      location: (r as Rehearsal).location || '',
      notes: (r as Rehearsal).notes || '',
    })
  }, [rehearsalId])

  useEffect(() => {
    getRehearsal(rehearsalId)
      .then((r) => {
        const rehearsalData = r as Rehearsal
        setRehearsal(rehearsalData)
        setForm({
          proposed_date: toDateInput(rehearsalData.proposed_date),
          start_time: toTimeInput(rehearsalData.start_time),
          end_time: toTimeInput(rehearsalData.end_time),
          location: rehearsalData.location || '',
          notes: rehearsalData.notes || '',
        })
      })
      .finally(() => setLoading(false))
  }, [rehearsalId])

  function handleChange(field: string, value: string | null) {
    setForm((prev) => ({ ...prev, [field]: value ?? '' }))
    if (hasRequiredErrors({ ...form, [field]: value } as Record<string, unknown>, REQUIRED_FIELDS)) return
    schedule({ [field]: value || null } as Partial<RehearsalForm>)
  }

  async function handleVote(memberId: Id | undefined, vote: string | null) {
    if (memberId === undefined || vote === null) return
    await setVote(rehearsalId, memberId, vote)
    await refresh()
  }

  async function handleRemoveParticipant(memberId: Id | undefined) {
    if (memberId === undefined) return
    await removeParticipant(rehearsalId, memberId)
    await refresh()
  }

  async function handleAddParticipant() {
    if (!addMemberId) return
    await addParticipant(rehearsalId, Number(addMemberId))
    setAddMemberId('')
    await refresh()
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
          <IconButton onClick={handleBack} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Rehearsal details</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={handleBack} aria-label="close">
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      {!loading && <PastEventAlert date={rehearsal?.proposed_date} />}

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
          />
          {rehearsal && (
            <>
              <RehearsalParticipantsSection
                rehearsal={rehearsal}
                members={members}
                addMemberId={addMemberId as Id | ''}
                onAddMemberIdChange={(id) => setAddMemberId(String(id))}
                onVote={handleVote}
                onRemoveParticipant={handleRemoveParticipant}
                onAddParticipant={handleAddParticipant}
                onPromote={handlePromote}
                onDemote={handleDemote}
                canWrite={canWritePlanning}
                currentMemberId={user?.bandMemberId ?? null}
              />
              <RehearsalSongsSection
                songs={rehearsal.songs ?? []}
                onAddSong={handleAddSong}
                onRemoveSong={handleRemoveSong}
                canWrite={canWritePlanning}
              />
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
            </>
          )}
        </Grid>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <SaveStatusLabel status={saveStatus} />
      </Box>

      {canWritePlanning && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </Box>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete rehearsal?</DialogTitle>
        <DialogContent>
          <DialogContentText>This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
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
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
