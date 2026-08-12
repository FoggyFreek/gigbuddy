import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import { createBandEvent, getBandEvent, updateBandEvent } from '../api/bandEvents.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { useTenantKind } from '../hooks/useTenantKind.ts'
import { TENANT_CAPABILITIES } from '../auth/tenantCapabilities.ts'
import { toDateInput } from '../utils/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import BandEventFields from './BandEventFields.tsx'
import MyBandSelect from './myBands/MyBandSelect.tsx'
import BandAvailabilityPanel, { type AvailabilityData } from './BandAvailabilityPanel.tsx'
import SaveStatusLabel from './SaveStatusLabel.tsx'
import type { Id, BandEvent } from '../types/entities.ts'

type BandEventDetail = BandEvent & { start_time?: string; end_time?: string; notes?: string }

interface BandEventFormModalProps {
  mode: 'create' | 'edit'
  bandEventId?: Id
  onClose: () => void
  initialDate?: string
}

const REQUIRED_FIELDS = ['title', 'start_date']

const EMPTY_FORM = {
  title: '',
  start_date: '',
  end_date: '',
  start_time: '',
  end_time: '',
  location: '',
  notes: '',
  my_band_id: null as Id | null,
}

export default function BandEventFormModal({ mode, bandEventId, onClose, initialDate }: Readonly<BandEventFormModalProps>) {
  const { t } = useTranslation(['bandEvents', 'common'])
  // A personal workspace has no roster, and /api/availability is gated on the
  // band_availability capability — asking there would 403.
  const showAvailability = useTenantKind().supports(TENANT_CAPABILITIES.BAND_AVAILABILITY)
  const supportsMyBand = useTenantKind().supports(TENANT_CAPABILITIES.MY_BANDS)
  const [form, setForm] = useState(() =>
    mode === 'create' && initialDate
      ? { ...EMPTY_FORM, start_date: initialDate, end_date: initialDate }
      : EMPTY_FORM
  )
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [availabilityData, setAvailabilityData] = useState<AvailabilityData | null>(null)
  const [confirmCreate, setConfirmCreate] = useState(false)

  const saveFn = useCallback(
    async (patch: Partial<BandEventDetail>) => { await updateBandEvent(bandEventId!, patch as Partial<BandEventDetail>) },
    [bandEventId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    if (mode !== 'edit') return
    getBandEvent(bandEventId!)
      .then((ev) => {
        const detail = ev as BandEventDetail
        setForm({
          title: detail.title || '',
          my_band_id: detail.my_band?.id ?? null,
          start_date: toDateInput(detail.start_date),
          end_date: toDateInput(detail.end_date),
          start_time: detail.start_time ? String(detail.start_time).slice(0, 5) : '',
          end_time: detail.end_time ? String(detail.end_time).slice(0, 5) : '',
          location: detail.location || '',
          notes: detail.notes || '',
        })
      })
      .finally(() => setLoading(false))
  }, [mode, bandEventId])

  function handleChange(field: string, value: string | boolean | null) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') {
      if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
      schedule({ [field]: value || null } as Partial<BandEventDetail>)
    }
  }

  async function doCreate() {
    await createBandEvent({
      title: form.title.trim(),
      start_date: form.start_date,
      end_date: form.end_date || null,
      ...({ start_time: form.start_time || null, end_time: form.end_time || null, location: form.location || null, notes: form.notes || null } as Partial<BandEventDetail>),
      ...(supportsMyBand ? ({ my_band_id: form.my_band_id || null } as Partial<BandEventDetail>) : {}),
    } as Partial<BandEventDetail>)
    onClose()
  }

  const unavailableLeads = (availabilityData?.members ?? []).filter(
    (member) => member.position === 'lead' && member.status === 'unavailable'
  )
  const marginLeads = (availabilityData?.members ?? []).filter(
    (member) => member.position === 'lead' && member.status === 'travel_margin'
  )

  async function handleCreate() {
    const errs: Record<string, string> = {}
    if (!form.title.trim()) errs.title = t($ => $.form.required)
    if (!form.start_date) errs.start_date = t($ => $.form.required)
    if (form.end_date && form.end_date < form.start_date) errs.end_date = t($ => $.form.endDateError)
    if (Object.keys(errs).length) { setErrors(errs); return }
    if (unavailableLeads.length > 0 || marginLeads.length > 0) {
      setConfirmCreate(true)
      return
    }
    await doCreate()
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{mode === 'create' ? t($ => $.form.addTitle) : t($ => $.form.detailsTitle)}</DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <BandEventFields
              form={form}
              onChange={handleChange}
              errors={mode === 'edit' ? { ...getRequiredErrors(form, REQUIRED_FIELDS), ...errors } : errors}
            />
            <Grid size={12}>
              <MyBandSelect
                value={form.my_band_id}
                onChange={(id) => handleChange('my_band_id', id === null ? null : String(id))}
              />
            </Grid>
            {mode === 'create' && showAvailability && form.start_date && (
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t($ => $.availability.title)}
                </Typography>
                <BandAvailabilityPanel
                  eventDate={form.start_date}
                  endDate={form.end_date || form.start_date}
                  eventType="band_event"
                  startTime={form.start_time}
                  endTime={form.end_time}
                  onDataLoad={setAvailabilityData}
                />
              </Grid>
            )}
          </Grid>
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && <SaveStatusLabel status={saveStatus} sx={undefined} />}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'create' ? (
          <>
            <Button onClick={onClose}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
            <Button variant="contained" onClick={handleCreate}>{t($ => $.form.addEvent)}</Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>{t($ => $.actions.close, { ns: 'common' })}</Button>
        )}
      </DialogActions>

      <Dialog open={confirmCreate} onClose={() => setConfirmCreate(false)}>
        <DialogTitle>{t($ => unavailableLeads.length > 0 ? $.form.unavailableTitle : $.form.travelMarginTitle)}</DialogTitle>
        <DialogContent>
          {unavailableLeads.length > 0 && <Typography>
            {t($ => $.form.unavailableBody, {
              names: unavailableLeads.map((member) => member.name).join(', '),
            })}
          </Typography>}
          {marginLeads.length > 0 && <Typography sx={{ mt: unavailableLeads.length > 0 ? 1 : 0 }}>
            {t($ => $.form.travelMarginBody, { names: marginLeads.map((member) => member.name).join(', ') })}
          </Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCreate(false)}>{t($ => $.form.goBack)}</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              setConfirmCreate(false)
              void doCreate()
            }}
          >
            {t($ => $.form.createAnyway)}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
