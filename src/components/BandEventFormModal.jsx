import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import { createBandEvent, getBandEvent, updateBandEvent } from '../api/bandEvents.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { toDateInput } from '../utils/eventFormUtils.js'
import BandEventFields from './BandEventFields.jsx'

const EMPTY_FORM = {
  title: '',
  start_date: '',
  end_date: '',
  start_time: '',
  end_time: '',
  location: '',
  notes: '',
}

export default function BandEventFormModal({ mode, bandEventId, onClose, initialDate }) {
  const [form, setForm] = useState(() =>
    mode === 'create' && initialDate
      ? { ...EMPTY_FORM, start_date: initialDate, end_date: initialDate }
      : EMPTY_FORM
  )
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(mode === 'edit')

  const saveFn = useCallback(
    async (patch) => { await updateBandEvent(bandEventId, patch) },
    [bandEventId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    if (mode !== 'edit') return
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
  }, [mode, bandEventId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') schedule({ [field]: value || null })
  }

  async function handleCreate() {
    const errs = {}
    if (!form.title.trim()) errs.title = 'Required'
    if (!form.start_date) errs.start_date = 'Required'
    if (form.end_date && form.end_date < form.start_date) errs.end_date = 'Must be on or after start date'
    if (Object.keys(errs).length) { setErrors(errs); return }
    await createBandEvent({
      title: form.title.trim(),
      start_date: form.start_date,
      end_date: form.end_date || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      location: form.location || null,
      notes: form.notes || null,
    })
    onClose()
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{mode === 'create' ? 'Add band event' : 'Band event'}</DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <BandEventFields form={form} onChange={handleChange} errors={errors} />
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
            <Button variant="contained" onClick={handleCreate}>Add event</Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
