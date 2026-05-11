import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import DeleteIcon from '@mui/icons-material/Delete'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import VoteToggle from '../components/VoteToggle.jsx'
import { dayjsToTimeString, timeStringToDayjs, toDateInput, toTimeInput } from '../utils/eventFormUtils.js'
import { addParticipant, getRehearsal, removeParticipant, setVote, updateRehearsal } from '../api/rehearsals.js'
import { listMembers } from '../api/bandMembers.js'

dayjs.extend(customParseFormat)

export default function RehearsalDetailPage() {
  const { id } = useParams()
  const rehearsalId = Number(id)
  const navigate = useNavigate()

  const [form, setForm] = useState({ proposed_date: '', start_time: '', end_time: '', location: '', notes: '' })
  const [loading, setLoading] = useState(true)
  const [rehearsal, setRehearsal] = useState(null)
  const [members, setMembers] = useState([])
  const [addMemberId, setAddMemberId] = useState('')
  const [focused, setFocused] = useState({ proposed_date: false })

  const onFocus = (field) => () => setFocused((p) => ({ ...p, [field]: true }))
  const onBlur = (field) => () => setFocused((p) => ({ ...p, [field]: false }))
  const maskSx = (field) => ({
    '& input::-webkit-datetime-edit': {
      opacity: focused[field] || form[field] ? 1 : 0,
    },
  })

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
    navigate(-1)
  }

  const participantIds = useMemo(
    () => new Set((rehearsal?.participants ?? []).map((p) => p.band_member_id)),
    [rehearsal]
  )
  const candidateMembers = members.filter((m) => !participantIds.has(m.id))
  const allYes =
    rehearsal?.participants?.length > 0 &&
    rehearsal.participants.every((p) => p.vote === 'yes')

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <IconButton onClick={handleBack} aria-label="back">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600}>Rehearsal details</Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Date"
              type="date"
              fullWidth
              value={form.proposed_date}
              onChange={(e) => handleChange('proposed_date', e.target.value)}
              onFocus={onFocus('proposed_date')}
              onBlur={onBlur('proposed_date')}
              slotProps={{ inputLabel: { shrink: focused.proposed_date || !!form.proposed_date } }}
              sx={maskSx('proposed_date')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Location"
              fullWidth
              value={form.location}
              onChange={(e) => handleChange('location', e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TimePicker
              label="Start time"
              ampm={false}
              value={timeStringToDayjs(form.start_time)}
              onChange={(v) => handleChange('start_time', dayjsToTimeString(v))}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TimePicker
              label="End time"
              ampm={false}
              value={timeStringToDayjs(form.end_time)}
              onChange={(v) => handleChange('end_time', dayjsToTimeString(v))}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>

          {rehearsal && (
            <>
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={600}>Status</Typography>
                  <Chip
                    label={rehearsal.status}
                    color={rehearsal.status === 'planned' ? 'primary' : 'default'}
                    size="small"
                  />
                  <Box sx={{ flexGrow: 1 }} />
                  {rehearsal.status === 'option' ? (
                    <Button variant="contained" disabled={!allYes} onClick={handlePromote}>
                      Plan this rehearsal
                    </Button>
                  ) : (
                    <Button variant="outlined" onClick={handleDemote}>Revert to option</Button>
                  )}
                </Box>
                {rehearsal.status === 'option' && !allYes && (
                  <Typography variant="caption" color="text.secondary">
                    Every required participant must vote yes before this can be planned.
                  </Typography>
                )}
              </Grid>

              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                  Required participants
                </Typography>
                <Stack spacing={1}>
                  {rehearsal.participants.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No participants yet — add at least one below.
                    </Typography>
                  )}
                  {rehearsal.participants.map((p) => (
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
                      {rehearsal.status !== 'planned' && (
                        <VoteToggle
                          vote={p.vote}
                          onChange={(v) => handleVote(p.band_member_id, v)}
                        />
                      )}
                      <IconButton
                        size="small"
                        aria-label={`remove ${p.name}`}
                        onClick={() => handleRemoveParticipant(p.band_member_id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>

                {candidateMembers.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel id="add-participant-label">Add participant</InputLabel>
                      <Select
                        labelId="add-participant-label"
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
                    <Button variant="outlined" disabled={!addMemberId} onClick={handleAddParticipant}>
                      Add
                    </Button>
                  </Box>
                )}
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
            </>
          )}
        </Grid>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
        <Button variant="contained" onClick={handleBack}>Close</Button>
      </Box>
    </Box>
  )
}
