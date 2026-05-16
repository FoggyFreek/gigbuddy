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
import { createVenue, getVenue, updateVenue } from '../api/venues.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import VenueFields from './VenueFields.jsx'

const EMPTY_FORM = {
  category: 'venue',
  name: '',
  city: '',
  country: '',
  province: '',
  address: '',
  website: '',
  contact_person: '',
  phone: '',
  email: '',
}

export default function VenueFormModal({ mode, venueId, onClose, onDelete }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saveFn = useCallback(
    async (patch) => { await updateVenue(venueId, patch) },
    [venueId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    if (mode !== 'edit') return
    getVenue(venueId)
      .then((v) => {
        setForm({
          category: v.category || 'venue',
          name: v.name || '',
          city: v.city || '',
          country: v.country ? String(v.country).trim() : '',
          province: v.province ? String(v.province).trim() : '',
          address: v.address || '',
          website: v.website || '',
          contact_person: v.contact_person || '',
          phone: v.phone || '',
          email: v.email || '',
        })
      })
      .finally(() => setLoading(false))
  }, [mode, venueId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') schedule({ [field]: value || null })
  }

  async function handleCreate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    await createVenue({
      category: form.category,
      name: form.name.trim(),
      city: form.city || null,
      country: form.country || null,
      province: form.province || null,
      address: form.address || null,
      website: form.website || null,
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      email: form.email || null,
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
      <DialogTitle>{mode === 'create' ? 'Add venue' : 'Venue'}</DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <VenueFields form={form} onChange={handleChange} errors={errors} />
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
            <Button variant="contained" onClick={handleCreate}>Add venue</Button>
          </>
        ) : confirmingDelete ? (
          <>
            <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
              Delete this venue?
            </Typography>
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={onDelete}>Delete</Button>
          </>
        ) : (
          <>
            <Button color="error" onClick={() => setConfirmingDelete(true)}>Delete</Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="contained" onClick={handleClose}>Close</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
