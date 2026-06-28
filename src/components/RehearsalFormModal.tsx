import type { Rehearsal, Member, Id } from '../types/entities.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import {
  addParticipant,
  createRehearsal,
  getRehearsal,
  removeParticipant,
  setVote,
  updateRehearsal,
} from '../api/rehearsals.ts'
import { getAvailabilityOn } from '../api/availability.ts'
import type { AvailabilityData } from './GigAvailabilityPanel.tsx'
import { listMembers } from '../api/bandMembers.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { toDateInput, toTimeInput } from '../utils/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import RehearsalFields from './RehearsalFields.tsx'
import RehearsalParticipantsSection from './RehearsalParticipantsSection.tsx'
import SaveStatusLabel from './SaveStatusLabel.tsx'

const REQUIRED_FIELDS = ['proposed_date']

interface RehearsalForm {
  proposed_date: string
  start_time: string
  end_time: string
  location: string
  notes: string
}

const EMPTY_FORM: RehearsalForm = {
  proposed_date: '',
  start_time: '',
  end_time: '',
  location: '',
  notes: '',
}

interface RehearsalFormModalProps {
  mode: 'create' | 'edit'
  rehearsalId?: Id
  onClose: () => void
  initialDate?: string
}

export default function RehearsalFormModal({ mode, rehearsalId, onClose, initialDate }: RehearsalFormModalProps) {
  const { t } = useTranslation(['rehearsals', 'common'])
  const [form, setForm] = useState<RehearsalForm>(() =>
    mode === 'create' && initialDate ? { ...EMPTY_FORM, proposed_date: initialDate } : EMPTY_FORM,
  )
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [extraMemberIds, setExtraMemberIds] = useState<Id[]>([])
  const [addMemberId, setAddMemberId] = useState<Id | ''>('')
  const [availabilityData, setAvailabilityData] = useState<AvailabilityData | null>(null)
  const [confirmCreate, setConfirmCreate] = useState(false)
  const availTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveFn = useCallback(
    async (patch: Record<string, unknown>) => { await updateRehearsal(rehearsalId!, patch) },
    [rehearsalId],
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {})
  }, [])

  // Fetch member availability on the proposed date (create mode only), debounced.
  // The render and create-guard both gate on form.proposed_date, so stale data
  // when the date is cleared is harmless (matches GigAvailabilityPanel).
  useEffect(() => {
    if (mode !== 'create' || !form.proposed_date) return
    clearTimeout(availTimerRef.current ?? undefined)
    availTimerRef.current = setTimeout(() => {
      getAvailabilityOn(form.proposed_date)
        .then((d) => setAvailabilityData(d as unknown as AvailabilityData))
        .catch(() => setAvailabilityData(null))
    }, 300)
    return () => {
      if (availTimerRef.current) clearTimeout(availTimerRef.current)
    }
  }, [mode, form.proposed_date])

  const refresh = useCallback(async () => {
    if (mode !== 'edit') return
    const r = await getRehearsal(rehearsalId!)
    setRehearsal(r)
    setForm({
      proposed_date: toDateInput(r.proposed_date),
      start_time: toTimeInput((r as Record<string, unknown>).start_time as string),
      end_time: toTimeInput((r as Record<string, unknown>).end_time as string),
      location: r.location || '',
      notes: (r as Record<string, unknown>).notes as string || '',
    })
  }, [mode, rehearsalId])

  useEffect(() => {
    if (mode !== 'edit') return
    getRehearsal(rehearsalId!)
      .then((r) => {
        setRehearsal(r)
        setForm({
          proposed_date: toDateInput(r.proposed_date),
          start_time: toTimeInput((r as Record<string, unknown>).start_time as string),
          end_time: toTimeInput((r as Record<string, unknown>).end_time as string),
          location: r.location || '',
          notes: (r as Record<string, unknown>).notes as string || '',
        })
      })
      .finally(() => setLoading(false))
  }, [mode, rehearsalId])

  function handleChange(field: string, value: string | null) {
    setForm((prev) => ({ ...prev, [field]: value ?? '' }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') {
      if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
      schedule({ [field]: value || null })
    }
  }

  async function doCreate() {
    await (createRehearsal as unknown as (body: Record<string, unknown>) => Promise<unknown>)({
      proposed_date: form.proposed_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      location: form.location || null,
      notes: form.notes || null,
      extra_member_ids: extraMemberIds,
    })
    onClose()
  }

  async function handleCreate() {
    const errs: Record<string, string> = {}
    if (!form.proposed_date) errs.proposed_date = t($ => $.form.required)
    if (Object.keys(errs).length) { setErrors(errs); return }

    if (unavailableSelected.length > 0) {
      setConfirmCreate(true)
      return
    }
    await doCreate()
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  async function handleVote(memberId: Id | undefined, vote: string | null) {
    await setVote(rehearsalId!, memberId!, vote ?? '')
    await refresh()
  }

  async function handleRemoveParticipant(memberId: Id | undefined) {
    await removeParticipant(rehearsalId!, memberId!)
    await refresh()
  }

  async function handleAddParticipant() {
    if (!addMemberId) return
    await addParticipant(rehearsalId!, Number(addMemberId))
    setAddMemberId('')
    await refresh()
  }

  async function handlePromote() {
    await flush()
    await updateRehearsal(rehearsalId!, { status: 'planned' })
    await refresh()
  }

  async function handleDemote() {
    await updateRehearsal(rehearsalId!, { status: 'option' })
    await refresh()
  }

  function toggleExtraMember(id: Id, isSelected: boolean) {
    setExtraMemberIds((prev) => isSelected ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const createExtras = members.filter((m) => m.position !== 'lead')

  // Members that will participate in the rehearsal: leads (auto-included) + chosen extras.
  const selectedMemberIds = new Set<Id>(
    members
      .filter((m) => m.position === 'lead' || (m.id !== undefined && extraMemberIds.includes(m.id)))
      .map((m) => m.id)
      .filter((id): id is Id => id !== undefined),
  )
  const unavailableSelected = (availabilityData?.members ?? []).filter(
    (m) => m.status === 'unavailable' && m.member_id !== undefined && selectedMemberIds.has(m.member_id),
  )

  return (
    <Dialog open fullWidth maxWidth="md" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>
        {mode === 'create' ? t($ => $.form.proposeTitle) : t($ => $.form.detailsTitle)}
      </DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <RehearsalFields
              form={form}
              onChange={handleChange}
              errors={mode === 'edit' ? { ...getRequiredErrors(form as unknown as Record<string, unknown>, REQUIRED_FIELDS), ...errors } : errors}
            />

            {mode === 'create' && createExtras.length > 0 && (
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t($ => $.form.alsoInclude)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {t($ => $.form.alsoIncludeHint)}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {createExtras.map((m) => {
                    const selected = m.id !== undefined && extraMemberIds.includes(m.id)
                    return (
                      <Chip
                        key={String(m.id)}
                        label={`${m.name} (${m.position})`}
                        clickable
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() => m.id !== undefined && toggleExtraMember(m.id, selected)}
                      />
                    )
                  })}
                </Stack>
              </Grid>
            )}

            {mode === 'create' && form.proposed_date && unavailableSelected.length > 0 && (
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t($ => $.form.memberAvailability)}
                </Typography>
                <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', minWidth: 0 }}>
                  {unavailableSelected.map((m) => {
                    const label = m.reason ? `${m.name} — ${m.reason}` : m.name
                    return (
                      <Tooltip key={String(m.member_id)} title={label ?? ''}>
                        <Chip
                          label={label}
                          color="error"
                          size="small"
                          sx={{ maxWidth: { xs: '100%', sm: 200 } }}
                        />
                      </Tooltip>
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
        {mode === 'edit' && <SaveStatusLabel status={saveStatus} />}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'create' ? (
          <>
            <Button onClick={onClose}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
            <Button variant="contained" onClick={handleCreate}>{t($ => $.form.propose)}</Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>{t($ => $.actions.close, { ns: 'common' })}</Button>
        )}
      </DialogActions>

      <Dialog open={confirmCreate} onClose={() => setConfirmCreate(false)}>
        <DialogTitle>{t($ => $.form.unavailableTitle)}</DialogTitle>
        <DialogContent>
          <Typography>
            {t($ => $.form.unavailableBody, {
              count: unavailableSelected.length,
              names: unavailableSelected.map((m) => m.name).join(', '),
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCreate(false)}>{t($ => $.form.goBack)}</Button>
          <Button variant="contained" color="warning" onClick={() => { setConfirmCreate(false); doCreate() }}>
            {t($ => $.form.proposeAnyway)}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
