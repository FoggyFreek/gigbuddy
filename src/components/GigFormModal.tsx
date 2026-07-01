import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import DateEntryField from './DateEntryField.tsx'
import GigAvailabilityPanel, { type AvailabilityData } from './GigAvailabilityPanel.tsx'
import GigDetailContent, { type GigDetailHandle } from './GigDetailContent.tsx'
import _SaveStatusLabelRaw from './SaveStatusLabel.tsx'
const SaveStatusLabel = _SaveStatusLabelRaw as React.ComponentType<{ status: string; sx?: unknown }>
import _VenuePickerRaw from './VenuePicker.tsx'
interface _VenuePickerProps {
  categoryFilter?: string
  value?: Venue | null
  onChange?: (v: Venue | null) => void
  onSelect?: (v: Venue) => void
  excludeIds?: (Id | undefined)[]
  disabled?: boolean
  label?: string
}
const VenuePicker = _VenuePickerRaw as React.ComponentType<_VenuePickerProps>
import { createGig } from '../api/gigs.ts'
import { dayjsToTimeString, timeStringToDayjs } from '../utils/eventFormUtils.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Id, Venue, Gig } from '../types/entities.ts'

dayjs.extend(customParseFormat)

const STATUSES = ['option', 'confirmed', 'announced'] as const

interface GigFormShape {
  event_date: string
  event_description: string
  venue_id: Id | null
  festival_id: Id | null
  start_time: string
  end_time: string
  status: string
  notes: string
  has_pa_system: boolean
  has_drumkit: boolean
  has_stage_lights: boolean
}

const EMPTY_FORM: GigFormShape = {
  event_date: '',
  event_description: '',
  venue_id: null,
  festival_id: null,
  start_time: '',
  end_time: '',
  status: 'option',
  notes: '',
  has_pa_system: false,
  has_drumkit: false,
  has_stage_lights: false,
}

interface GigFormModalProps {
  mode: 'create' | 'edit'
  gigId?: Id
  onClose: () => void
  initialDate?: string
}

export default function GigFormModal({ mode, gigId, onClose, initialDate }: Readonly<GigFormModalProps>) {
  const { t } = useTranslation(['gigs', 'common'])
  const contentRef = useRef<GigDetailHandle | null>(null)
  const { canWritePlanning: canWrite } = usePermissions()

  // ── Create mode state ──────────────────────────────────────────────────────
  const [form, setForm] = useState<GigFormShape>(() =>
    mode === 'create' && initialDate ? { ...EMPTY_FORM, event_date: initialDate } : EMPTY_FORM
  )
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [selectedFestival, setSelectedFestival] = useState<Venue | null>(null)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [availabilityData, setAvailabilityData] = useState<AvailabilityData | null>(null)
  const [confirmCreate, setConfirmCreate] = useState(false)

  // ── Edit mode state ────────────────────────────────────────────────────────
  const [polledStatus, setPolledStatus] = useState('idle')

  useEffect(() => {
    if (mode !== 'edit') return
    const interval = setInterval(() => {
      setPolledStatus(contentRef.current?.saveStatus ?? 'idle')
    }, 100)
    return () => clearInterval(interval)
  }, [mode])

  function handleChange(field: string, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const unavailableLeads = (availabilityData?.members ?? []).filter(
    (m) => m.position === 'lead' && m.status === 'unavailable'
  )

  async function doCreate() {
    await createGig({
      event_date: form.event_date,
      event_description: form.event_description,
      venue_id: form.venue_id,
      festival_id: form.festival_id,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      status: form.status,
      // Extra fields not in base Gig type — server accepts them
      ...({ has_pa_system: form.has_pa_system, has_drumkit: form.has_drumkit, has_stage_lights: form.has_stage_lights } as Partial<Gig>),
    })
    onClose()
  }

  async function handleCreate() {
    const errs: Record<string, string> = {}
    if (!form.event_date) errs.event_date = t($ => $.form.required)
    if (!form.event_description.trim()) errs.event_description = t($ => $.form.required)
    if (Object.keys(errs).length) { setErrors(errs); return }

    if (unavailableLeads.length > 0) {
      setConfirmCreate(true)
      return
    }
    await doCreate()
  }

  async function handleClose() {
    await contentRef.current?.flush()
    onClose()
  }

  return (
    <Dialog open fullWidth maxWidth="md" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{mode === 'create' ? t($ => $.form.newGig) : t($ => $.form.gigDetails)}</DialogTitle>

      <DialogContent>
        {mode === 'edit' ? (
          <GigDetailContent ref={contentRef} gigId={gigId!} canWrite={canWrite} />
        ) : (
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateEntryField
                label={t($ => $.form.date)}
                fullWidth
                value={form.event_date}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('event_date', e.target.value)}
                error={!!errors.event_date}
                helperText={errors.event_date}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t($ => $.form.eventDescription)}
                fullWidth
                value={form.event_description}
                onChange={(e) => handleChange('event_description', e.target.value)}
                error={!!errors.event_description}
                helperText={errors.event_description}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <VenuePicker
                categoryFilter="festival"
                value={selectedFestival}
                onChange={(v: Venue | null) => {
                  setSelectedFestival(v)
                  handleChange('festival_id', v?.id ?? null)
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <VenuePicker
                categoryFilter="venue"
                value={selectedVenue}
                onChange={(v: Venue | null) => {
                  setSelectedVenue(v)
                  handleChange('venue_id', v?.id ?? null)
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TimePicker
                label={t($ => $.form.startTime)}
                ampm={false}
                value={timeStringToDayjs(form.start_time)}
                onChange={(v) => handleChange('start_time', dayjsToTimeString(v))}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TimePicker
                label={t($ => $.form.endTime)}
                ampm={false}
                value={timeStringToDayjs(form.end_time)}
                onChange={(v) => handleChange('end_time', dayjsToTimeString(v))}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label={t($ => $.form.status)}
                fullWidth
                value={form.status}
                onChange={(e) => handleChange('status', e.target.value)}
              >
                {STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>{t($ => $.status[s])}</MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t($ => $.form.memberAvailability)}
              </Typography>
              <GigAvailabilityPanel
                eventDate={form.event_date}
                onDataLoad={setAvailabilityData}
              />
            </Grid>
          </Grid>
        )}
      </DialogContent>

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && <SaveStatusLabel status={polledStatus} />}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'create' ? (
          <>
            <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
            <Button variant="contained" onClick={handleCreate}>{t($ => $.form.create)}</Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>{t($ => $.common.actions.close)}</Button>
        )}
      </DialogActions>

      <Dialog open={confirmCreate} onClose={() => setConfirmCreate(false)}>
        <DialogTitle>{t($ => $.form.unavailableTitle)}</DialogTitle>
        <DialogContent>
          <Typography>
            {t($ => $.form.unavailableBody, {
              names: unavailableLeads.map((m) => m.name).join(', '),
              count: unavailableLeads.length,
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCreate(false)}>{t($ => $.form.goBack)}</Button>
          <Button variant="contained" color="warning" onClick={() => { setConfirmCreate(false); doCreate() }}>
            {t($ => $.form.createAnyway)}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
