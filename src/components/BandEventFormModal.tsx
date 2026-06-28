import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import { createBandEvent, getBandEvent, updateBandEvent } from '../api/bandEvents.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { toDateInput } from '../utils/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import BandEventFields from './BandEventFields.tsx'
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
}

export default function BandEventFormModal({ mode, bandEventId, onClose, initialDate }: BandEventFormModalProps) {
  const { t } = useTranslation(['bandEvents', 'common'])
  const [form, setForm] = useState(() =>
    mode === 'create' && initialDate
      ? { ...EMPTY_FORM, start_date: initialDate, end_date: initialDate }
      : EMPTY_FORM
  )
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [loading, setLoading] = useState(mode === 'edit')

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

  async function handleCreate() {
    const errs: Record<string, string> = {}
    if (!form.title.trim()) errs.title = t($ => $.form.required)
    if (!form.start_date) errs.start_date = t($ => $.form.required)
    if (form.end_date && form.end_date < form.start_date) errs.end_date = t($ => $.form.endDateError)
    if (Object.keys(errs).length) { setErrors(errs); return }
    await createBandEvent({
      title: form.title.trim(),
      start_date: form.start_date,
      end_date: form.end_date || null,
      ...({ start_time: form.start_time || null, end_time: form.end_time || null, location: form.location || null, notes: form.notes || null } as Partial<BandEventDetail>),
    } as Partial<BandEventDetail>)
    onClose()
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
    </Dialog>
  )
}
