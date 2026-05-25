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
import { createVenue, getVenueCategoryImpact, getVenue, updateVenue } from '../api/venues.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.js'
import SaveStatusLabel from './SaveStatusLabel.jsx'
import VenueFields from './VenueFields.jsx'

const REQUIRED_FIELDS = ['name']

const EMPTY_FORM = {
  category: 'venue',
  name: '',
  title: '',
  given_name: '',
  family_name: '',
  organization_name: '',
  street_and_number: '',
  street_additional: '',
  postal_code: '',
  city: '',
  region: '',
  country: '',
  website: '',
  phone: '',
  email: '',
}

export default function VenueFormModal({ mode, venueId, onClose, onDelete, initial, onCreated, lockedCategory }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...(initial || {}) }))
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [categoryChange, setCategoryChange] = useState(null) // { newCategory, prevCategory, affectedGigs }
  const [categorySaving, setCategorySaving] = useState(false)

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
          title: v.title || '',
          given_name: v.given_name || '',
          family_name: v.family_name || '',
          organization_name: v.organization_name || '',
          street_and_number: v.street_and_number || '',
          street_additional: v.street_additional || '',
          postal_code: v.postal_code || '',
          city: v.city || '',
          region: v.region || '',
          country: v.country ? String(v.country).trim() : '',
          website: v.website || '',
          phone: v.phone || '',
          email: v.email || '',
        })
      })
      .finally(() => setLoading(false))
  }, [mode, venueId])

  async function handleCategoryChangeCheck(newCategory, prevCategory) {
    try {
      const { affected_gigs: affectedGigs } = await getVenueCategoryImpact(venueId, newCategory)
      if (!affectedGigs.length) {
        schedule({ category: newCategory })
      } else {
        setCategoryChange({ newCategory, prevCategory, affectedGigs })
      }
    } catch {
      // Revert on error
      setForm((prev) => ({ ...prev, category: prevCategory }))
    }
  }

  async function handleCategoryConfirm(action) {
    const { newCategory } = categoryChange
    setCategoryChange(null)
    setCategorySaving(true)
    try {
      await updateVenue(venueId, { category: newCategory, on_affected_gigs: action })
    } finally {
      setCategorySaving(false)
    }
  }

  function handleCategoryCancel() {
    setForm((prev) => ({ ...prev, category: categoryChange.prevCategory }))
    setCategoryChange(null)
  }

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') {
      if (field === 'category') {
        handleCategoryChangeCheck(value, form.category)
        return
      }
      if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
      schedule({ [field]: value || null })
    }
  }

  async function handleCreate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    const venue = await createVenue({
      category: form.category,
      name: form.name.trim(),
      title: form.title || null,
      given_name: form.given_name || null,
      family_name: form.family_name || null,
      organization_name: form.organization_name || null,
      street_and_number: form.street_and_number || null,
      street_additional: form.street_additional || null,
      postal_code: form.postal_code || null,
      city: form.city || null,
      region: form.region || null,
      country: form.country || null,
      website: form.website || null,
      phone: form.phone || null,
      email: form.email || null,
    })
    onCreated?.(venue)
    onClose()
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  return (
    <>
    <Dialog open fullWidth maxWidth="sm" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{mode === 'create' ? 'Add venue' : 'Venue'}</DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <VenueFields
              form={form}
              onChange={handleChange}
              errors={mode === 'edit' ? { ...getRequiredErrors(form, REQUIRED_FIELDS), ...errors } : errors}
              lockedCategory={lockedCategory}
            />
          </Grid>
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && <SaveStatusLabel status={categorySaving ? 'saving' : saveStatus} />}
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

    {categoryChange && (
      <Dialog open onClose={handleCategoryCancel} maxWidth="sm" fullWidth>
        <DialogTitle>
          Category change affects {categoryChange.affectedGigs.length} gig{categoryChange.affectedGigs.length !== 1 ? 's' : ''}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            The following {categoryChange.affectedGigs.length === 1 ? 'gig links' : 'gigs link'} to this record
            as a <strong>{categoryChange.prevCategory}</strong>. Changing to
            a <strong>{categoryChange.newCategory}</strong> requires each gig's link to be updated.
          </Typography>
          <Box component="ul" sx={{ pl: 2, mt: 1, mb: 2 }}>
            {categoryChange.affectedGigs.map((g) => (
              <li key={g.id}>
                <Typography variant="body2">
                  {g.event_description || '(untitled)'} — {String(g.event_date).slice(0, 10)}
                </Typography>
              </li>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary">
            <strong>Move links</strong> — keep each gig linked to this record, moved to
            the {categoryChange.newCategory} slot.
            <br />
            <strong>Remove links</strong> — unlink each gig from this record entirely.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCategoryCancel}>Cancel</Button>
          <Button onClick={() => handleCategoryConfirm('remove')}>Remove links</Button>
          <Button variant="contained" onClick={() => handleCategoryConfirm('migrate')}>
            Move links
          </Button>
        </DialogActions>
      </Dialog>
    )}
    </>
  )
}
