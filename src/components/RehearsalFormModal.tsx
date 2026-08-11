import type { Rehearsal, Member, Id } from '../types/entities.ts'
import { useCallback, useEffect, useState } from 'react'
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
import Typography from '@mui/material/Typography'
import {
  addParticipant,
  createRehearsal,
  getRehearsal,
  removeParticipant,
  setVote,
  updateRehearsal,
} from '../api/rehearsals.ts'
import BandAvailabilityPanel, { type AvailabilityData } from './BandAvailabilityPanel.tsx'
import { listMembers } from '../api/bandMembers.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { toDateInput, toTimeInput } from '../utils/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import { useTenantKind } from '../hooks/useTenantKind.ts'
import { TENANT_CAPABILITIES } from '../auth/tenantCapabilities.ts'
import MyBandSelect from './myBands/MyBandSelect.tsx'
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
  /** Which of the artist's bands; personal workspaces only. */
  my_band_id: Id | null
}

const EMPTY_FORM: RehearsalForm = {
  proposed_date: '',
  start_time: '',
  end_time: '',
  location: '',
  notes: '',
  my_band_id: null,
}

interface RehearsalFormModalProps {
  mode: 'create' | 'edit'
  rehearsalId?: Id
  onClose: () => void
  initialDate?: string
}

export default function RehearsalFormModal({ mode, rehearsalId, onClose, initialDate }: Readonly<RehearsalFormModalProps>) {
  const { t } = useTranslation(['rehearsals', 'common'])
  const supportsMyBand = useTenantKind().supports(TENANT_CAPABILITIES.MY_BANDS)
  // A personal workspace has no roster, and /api/availability is gated on the
  // band_availability capability — asking there would 403.
  const showAvailability = useTenantKind().supports(TENANT_CAPABILITIES.BAND_AVAILABILITY)
  const [form, setForm] = useState<RehearsalForm>(() =>
    mode === 'create' && initialDate ? { ...EMPTY_FORM, proposed_date: initialDate } : EMPTY_FORM,
  )
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [extraMemberIds, setExtraMemberIds] = useState<Id[]>([])
  const [availabilityData, setAvailabilityData] = useState<AvailabilityData | null>(null)
  const [confirmCreate, setConfirmCreate] = useState(false)

  const saveFn = useCallback(
    async (patch: Record<string, unknown>) => { await updateRehearsal(rehearsalId!, patch) },
    [rehearsalId],
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {})
  }, [])

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
      my_band_id: r.my_band?.id ?? null,
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
          my_band_id: r.my_band?.id ?? null,
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
      ...(supportsMyBand ? { my_band_id: form.my_band_id || null } : {}),
      extra_member_ids: extraMemberIds,
    })
    onClose()
  }

  async function handleCreate() {
    const errs: Record<string, string> = {}
    if (!form.proposed_date) errs.proposed_date = t($ => $.form.required)
    if (Object.keys(errs).length) { setErrors(errs); return }

    if (unavailableSelected.length > 0 || marginSelected.length > 0) {
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

  async function handleAddParticipant(memberId: Id) {
    await addParticipant(rehearsalId!, Number(memberId))
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
  const marginSelected = (availabilityData?.members ?? []).filter(
    (m) => m.status === 'travel_margin' && m.member_id !== undefined && selectedMemberIds.has(m.member_id),
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

            <Grid size={12}>
              <MyBandSelect
                value={form.my_band_id}
                onChange={(id) => handleChange('my_band_id', id === null ? null : String(id))}
              />
            </Grid>

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

            {showAvailability && mode === 'create' && (
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t($ => $.form.memberAvailability)}
                </Typography>
                <BandAvailabilityPanel
                  eventDate={form.proposed_date}
                  eventType="rehearsal"
                  startTime={form.start_time}
                  endTime={form.end_time}
                  participantIds={[...selectedMemberIds]}
                  onDataLoad={setAvailabilityData}
                />
              </Grid>
            )}

            {mode === 'edit' && rehearsal && (
              <RehearsalParticipantsSection
                rehearsal={rehearsal}
                members={members}
                onVote={handleVote}
                onRemoveParticipant={handleRemoveParticipant}
                onAddParticipant={handleAddParticipant}
                onPromote={handlePromote}
                onDemote={handleDemote}
                showAvailability={showAvailability}
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
        <DialogTitle>{t($ => unavailableSelected.length > 0 ? $.form.unavailableTitle : $.form.travelMarginTitle)}</DialogTitle>
        <DialogContent>
          {unavailableSelected.length > 0 && <Typography>
            {t($ => $.form.unavailableBody, {
              count: unavailableSelected.length,
              names: unavailableSelected.map((m) => m.name).join(', '),
            })}
          </Typography>}
          {marginSelected.length > 0 && <Typography sx={{ mt: unavailableSelected.length > 0 ? 1 : 0 }}>
            {t($ => $.form.travelMarginBody, { names: marginSelected.map((m) => m.name).join(', ') })}
          </Typography>}
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
