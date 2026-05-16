import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  addParticipant,
  createRehearsal,
  getRehearsal,
  removeParticipant,
  setVote,
  updateRehearsal,
} from '../api/rehearsals.js'
import { listMembers } from '../api/bandMembers.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { toDateInput, toTimeInput } from '../utils/eventFormUtils.js'
import RehearsalFields from './RehearsalFields.jsx'
import RehearsalParticipantsSection from './RehearsalParticipantsSection.jsx'

const EMPTY_FORM = {
  proposed_date: '',
  start_time: '',
  end_time: '',
  location: '',
  notes: '',
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
    if (mode === 'edit') schedule({ [field]: value || null })
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

  const createExtras = members.filter((m) => m.position !== 'lead')

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStatus]
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
            <RehearsalFields form={form} onChange={handleChange} errors={errors} />

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
