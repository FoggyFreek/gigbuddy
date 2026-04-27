import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
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
import DeleteIcon from '@mui/icons-material/Delete'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import useDebouncedSave from '../hooks/useDebouncedSave.js'

dayjs.extend(customParseFormat)

function timeStringToDayjs(val) {
  if (!val) return null
  const d = dayjs(val, 'HH:mm')
  return d.isValid() ? d : null
}

function dayjsToTimeString(d) {
  if (!d || !d.isValid()) return ''
  return d.format('HH:mm')
}
import {
  addParticipant,
  createRehearsal,
  getRehearsal,
  removeParticipant,
  setVote,
  updateRehearsal,
} from '../api/rehearsals.js'
import { listMembers } from '../api/bandMembers.js'

const EMPTY_FORM = {
  proposed_date: '',
  start_time: '',
  end_time: '',
  location: '',
  notes: '',
}

function toDateInput(val) {
  if (!val) return ''
  return String(val).slice(0, 10)
}

function toTimeInput(val) {
  if (!val) return ''
  return String(val).slice(0, 5)
}

function VoteToggle({ vote, onChange }) {
  return (
    <ButtonGroup size="small" variant="outlined">
      <Button
        variant={vote === 'yes' ? 'contained' : 'outlined'}
        color="success"
        onClick={() => onChange(vote === 'yes' ? null : 'yes')}
      >
        Yes
      </Button>
      <Button
        variant={vote === 'no' ? 'contained' : 'outlined'}
        color="error"
        onClick={() => onChange(vote === 'no' ? null : 'no')}
      >
        No
      </Button>
    </ButtonGroup>
  )
}

export default function RehearsalFormModal({ mode, rehearsalId, onClose, initialDate }) {
  const [form, setForm] = useState(() =>
    mode === 'create' && initialDate ? { ...EMPTY_FORM, proposed_date: initialDate } : EMPTY_FORM
  )
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [rehearsal, setRehearsal] = useState(null)
  const [members, setMembers] = useState([])
  const [extraMemberIds, setExtraMemberIds] = useState([])
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
    if (mode !== 'edit') return
    const r = await getRehearsal(rehearsalId)
    setRehearsal(r)
    setForm({
      proposed_date: toDateInput(r.proposed_date),
      start_time: toTimeInput(r.start_time),
      end_time: toTimeInput(r.end_time),
      location: r.location || '',
      notes: r.notes || '',
    })
  }, [mode, rehearsalId])

  useEffect(() => {
    if (mode !== 'edit') return
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
  }, [mode, rehearsalId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') {
      schedule({ [field]: value || null })
    }
  }

  async function handleCreate() {
    const errs = {}
    if (!form.proposed_date) errs.proposed_date = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    await createRehearsal({
      proposed_date: form.proposed_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      location: form.location || null,
      notes: form.notes || null,
      extra_member_ids: extraMemberIds,
    })
    onClose()
  }

  async function handleClose() {
    await flush()
    onClose()
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

  const participantIds = useMemo(
    () => new Set((rehearsal?.participants ?? []).map((p) => p.band_member_id)),
    [rehearsal]
  )
  const candidateMembers = members.filter((m) => !participantIds.has(m.id))
  const allYes =
    rehearsal?.participants?.length > 0 &&
    rehearsal.participants.every((p) => p.vote === 'yes')

  // Create-mode candidates: non-lead members ('optional' / 'sub') the creator can pre-include.
  const createExtras = members.filter((m) => m.position !== 'lead')

  const saveLabel = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Dialog open fullWidth maxWidth="md" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>
        {mode === 'create' ? 'Propose rehearsal' : 'Rehearsal details'}
      </DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Date"
                type="date"
                fullWidth
                value={form.proposed_date}
                onChange={(e) => handleChange('proposed_date', e.target.value)}
                onFocus={onFocus('proposed_date')}
                onBlur={onBlur('proposed_date')}
                error={!!errors.proposed_date}
                helperText={errors.proposed_date}
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

            {mode === 'create' && createExtras.length > 0 && (
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                  Also include
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Lead members are added automatically. Pick optionals or subs you also need.
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {createExtras.map((m) => {
                    const selected = extraMemberIds.includes(m.id)
                    return (
                      <Chip
                        key={m.id}
                        label={`${m.name} (${m.position})`}
                        clickable
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() =>
                          setExtraMemberIds((prev) =>
                            selected ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                          )
                        }
                      />
                    )
                  })}
                </Stack>
              </Grid>
            )}

            {mode === 'edit' && rehearsal && (
              <>
                <Grid size={12}>
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Status
                    </Typography>
                    <Chip
                      label={rehearsal.status}
                      color={rehearsal.status === 'planned' ? 'primary' : 'default'}
                      size="small"
                    />
                    <Box sx={{ flexGrow: 1 }} />
                    {rehearsal.status === 'option' ? (
                      <Button
                        variant="contained"
                        disabled={!allYes}
                        onClick={handlePromote}
                      >
                        Plan this rehearsal
                      </Button>
                    ) : (
                      <Button variant="outlined" onClick={handleDemote}>
                        Revert to option
                      </Button>
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
                        <VoteToggle
                          vote={p.vote}
                          onChange={(v) => handleVote(p.band_member_id, v)}
                        />
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
                      <Button
                        variant="outlined"
                        disabled={!addMemberId}
                        onClick={handleAddParticipant}
                      >
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
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && (
          <Typography variant="caption" color={saveColor}>
            {saveLabel}
          </Typography>
        )}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'create' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate}>Propose</Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
