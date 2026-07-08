import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import { deleteBandEvent, getBandEvent, updateBandEvent } from '../api/bandEvents.ts'
import type { BandEvent } from '../types/entities.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { toDateInput } from '../utils/eventFormUtils.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import BandEventFields from '../components/BandEventFields.tsx'
import PastEventAlert from '../components/PastEventAlert.tsx'
import SaveStatusLabel from '../components/SaveStatusLabel.tsx'
import { usePermissions } from '../hooks/usePermissions.ts'
import PlanningReadOnlyAlert from '../components/PlanningReadOnlyAlert.tsx'

const REQUIRED_FIELDS = ['title', 'start_date']

interface BandEventDetail extends BandEvent {
  start_time?: string
  end_time?: string
  notes?: string
}

interface BandEventForm {
  [key: string]: unknown
  title: string
  start_date: string
  end_date: string
  start_time: string
  end_time: string
  location: string
  notes: string
}

export default function BandEventDetailPage() {
  const { t } = useTranslation(['bandEvents', 'common'])
  const { id } = useParams()
  const bandEventId = Number(id)
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const outletCtx = (useOutletContext() || {}) as Record<string, unknown>
  const insideSplitView = !!outletCtx.insideSplitView

  const [form, setForm] = useState<BandEventForm>({
    title: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    location: '',
    notes: '',
  })
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const saveFn = useCallback(
    async (patch: Partial<BandEventForm>) => { await updateBandEvent(bandEventId, patch) },
    [bandEventId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(
    saveFn,
    600,
    (patch) => {
      if (typeof outletCtx.onBandEventUpdate === 'function') {
        outletCtx.onBandEventUpdate(bandEventId, patch)
      }
    }
  )

  useEffect(() => {
    getBandEvent(bandEventId)
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
  }, [bandEventId])

  function handleChange(field: string, value: string | boolean | null) {
    if (!canWritePlanning) return
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
    schedule({ [field]: value || null })
  }

  async function handleBack() {
    await flush()
    if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
    else navigate(-1)
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label={t($ => $.aria.back, { ns: 'common' })}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>{t($ => $.page.title)}</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={handleBack} aria-label={t($ => $.aria.close, { ns: 'common' })}>
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      {!loading && <PastEventAlert date={form.end_date || form.start_date} />}
      <PlanningReadOnlyAlert canWrite={canWritePlanning} />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <BandEventFields
            form={form}
            onChange={handleChange}
            errors={{ ...getRequiredErrors(form, REQUIRED_FIELDS), ...errors }}
            readOnly={!canWritePlanning}
          />
        </Grid>
      )}

      {canWritePlanning && (
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
          <SaveStatusLabel status={saveStatus} />
        </Box>
      )}

      {canWritePlanning && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => setConfirmDelete(true)}>
            {t($ => $.actions.delete, { ns: 'common' })}
          </Button>
        </Box>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t($ => $.page.deleteConfirmTitle)}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t($ => $.confirmation.cannotUndo, { ns: 'common' })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              setConfirmDelete(false)
              await deleteBandEvent(bandEventId)
              if (typeof outletCtx.onBandEventDelete === 'function') outletCtx.onBandEventDelete(bandEventId)
              if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
              else navigate(-1)
            }}
          >
            {t($ => $.actions.delete, { ns: 'common' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
