import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { toDateInput, toTimeInput } from '../utils/eventFormUtils.js'
import { addParticipant, getRehearsal, removeParticipant, setVote, updateRehearsal } from '../api/rehearsals.js'
import { listMembers } from '../api/bandMembers.js'
import RehearsalFields from '../components/RehearsalFields.jsx'
import RehearsalParticipantsSection from '../components/RehearsalParticipantsSection.jsx'

export default function RehearsalDetailPage() {
  const { id } = useParams()
  const rehearsalId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  const [form, setForm] = useState({ proposed_date: '', start_time: '', end_time: '', location: '', notes: '' })
  const [loading, setLoading] = useState(true)
  const [rehearsal, setRehearsal] = useState(null)
  const [members, setMembers] = useState([])
  const [addMemberId, setAddMemberId] = useState('')

  const saveFn = useCallback(
    async (patch) => { await updateRehearsal(rehearsalId, patch) },
    [rehearsalId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

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

  async function handlePromote() {
    await flush()
    await updateRehearsal(rehearsalId, { status: 'planned' })
    await refresh()
  }

  async function handleDemote() {
    await updateRehearsal(rehearsalId, { status: 'option' })
    await refresh()
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
          <RehearsalFields form={form} onChange={handleChange} />
          {rehearsal && (
            <RehearsalParticipantsSection
              rehearsal={rehearsal}
              members={members}
              addMemberId={addMemberId}
              onAddMemberIdChange={setAddMemberId}
              notes={form.notes}
              onNotesChange={(v) => handleChange('notes', v)}
              onVote={handleVote}
              onRemoveParticipant={handleRemoveParticipant}
              onAddParticipant={handleAddParticipant}
              onPromote={handlePromote}
              onDemote={handleDemote}
            />
          )}
        </Grid>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
      </Box>
    </Box>
  )
}
