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
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { toDateInput, toTimeInput } from '../utils/eventFormUtils.js'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.js'
import { addParticipant, addSong, deleteRehearsal, getRehearsal, removeParticipant, removeSong, setVote, updateRehearsal } from '../api/rehearsals.js'
import { listMembers } from '../api/bandMembers.js'
import RehearsalFields from '../components/RehearsalFields.jsx'
import RehearsalParticipantsSection from '../components/RehearsalParticipantsSection.jsx'
import RehearsalSongsSection from '../components/RehearsalSongsSection.jsx'
import SaveStatusLabel from '../components/SaveStatusLabel.jsx'

const REQUIRED_FIELDS = ['proposed_date']

export default function RehearsalDetailPage() {
  const { id } = useParams()
  const rehearsalId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  const [form, setForm] = useState({ proposed_date: '', start_time: '', end_time: '', location: '', notes: '' })
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rehearsal, setRehearsal] = useState(null)
  const [members, setMembers] = useState([])
  const [addMemberId, setAddMemberId] = useState('')

  const saveFn = useCallback(
    async (patch) => { await updateRehearsal(rehearsalId, patch) },
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
    setRehearsal(r)
    setForm({
      proposed_date: toDateInput(r.proposed_date),
      start_time: toTimeInput(r.start_time),
      end_time: toTimeInput(r.end_time),
      location: r.location || '',
      notes: r.notes || '',
    })
  }, [rehearsalId])

  useEffect(() => {
    getRehearsal(rehearsalId)
      .then((r) => {
        setRehearsal(r)
        setForm({
          proposed_date: toDateInput(r.proposed_date),
          start_time: toTimeInput(r.start_time),
          end_time: toTimeInput(r.end_time),
          location: r.location || '',
          notes: r.notes || '',
        })
      })
      .finally(() => setLoading(false))
  }, [rehearsalId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
    schedule({ [field]: value || null })
  }

  async function handleVote(memberId, vote) {
    await setVote(rehearsalId, memberId, vote)
    await refresh()
  }

  async function handleRemoveParticipant(memberId) {
    await removeParticipant(rehearsalId, memberId)
    await refresh()
  }

  async function handleAddParticipant() {
    if (!addMemberId) return
    await addParticipant(rehearsalId, Number(addMemberId))
    setAddMemberId('')
    await refresh()
  }

  async function handleAddSong(song) {
    const updated = await addSong(rehearsalId, song.id)
    setRehearsal((prev) => ({ ...prev, songs: updated.songs }))
  }

  async function handleRemoveSong(songId) {
    await removeSong(rehearsalId, songId)
    setRehearsal((prev) => ({
      ...prev,
      songs: (prev.songs ?? []).filter((s) => s.song_id !== songId),
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
        <Typography variant="h5" fontWeight={600}>Rehearsal details</Typography>
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
          <RehearsalFields
            form={form}
            onChange={handleChange}
            errors={getRequiredErrors(form, REQUIRED_FIELDS)}
          />
          {rehearsal && (
            <>
              <RehearsalParticipantsSection
                rehearsal={rehearsal}
                members={members}
                addMemberId={addMemberId}
                onAddMemberIdChange={setAddMemberId}
                onVote={handleVote}
                onRemoveParticipant={handleRemoveParticipant}
                onAddParticipant={handleAddParticipant}
                onPromote={handlePromote}
                onDemote={handleDemote}
              />
              <RehearsalSongsSection
                songs={rehearsal.songs ?? []}
                onAddSong={handleAddSong}
                onRemoveSong={handleRemoveSong}
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

      <Box sx={{ mt: 4 }}>
        <Button color="error" variant="contained" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </Box>

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
              await deleteRehearsal(rehearsalId)
              setConfirmDelete(false)
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
