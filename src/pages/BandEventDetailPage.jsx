import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import { getBandEvent, updateBandEvent } from '../api/bandEvents.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { toDateInput } from '../utils/eventFormUtils.js'
import BandEventFields from '../components/BandEventFields.jsx'

export default function BandEventDetailPage() {
  const { id } = useParams()
  const bandEventId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  const [form, setForm] = useState({
    title: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    location: '',
    notes: '',
  })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)

  const saveFn = useCallback(
    async (patch) => { await updateBandEvent(bandEventId, patch) },
    [bandEventId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    getBandEvent(bandEventId)
      .then((ev) => {
        setForm({
          title: ev.title || '',
          start_date: toDateInput(ev.start_date),
          end_date: toDateInput(ev.end_date),
          start_time: ev.start_time ? String(ev.start_time).slice(0, 5) : '',
          end_time: ev.end_time ? String(ev.end_time).slice(0, 5) : '',
          location: ev.location || '',
          notes: ev.notes || '',
        })
      })
      .finally(() => setLoading(false))
  }, [bandEventId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    schedule({ [field]: value || null })
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
        <Typography variant="h5" fontWeight={600}>Band event details</Typography>
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
          <BandEventFields form={form} onChange={handleChange} errors={errors} />
        </Grid>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
      </Box>
    </Box>
  )
}
