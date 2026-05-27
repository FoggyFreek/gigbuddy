import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import {
  addVenueContact,
  deleteVenue,
  getVenue,
  getVenueCategoryImpact,
  listVenueContacts,
  removeVenueContact,
  setVenueContactPrimary,
  updateVenue,
} from '../api/venues.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.js'
import ContactPicker from '../components/ContactPicker.jsx'
import SaveStatusLabel from '../components/SaveStatusLabel.jsx'
import VenueFields from '../components/VenueFields.jsx'

const REQUIRED_FIELDS = ['name']

export default function VenueDetailPage() {
  const { id } = useParams()
  const venueId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  function closeView() {
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  const [form, setForm] = useState({
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
  })
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [categoryChange, setCategoryChange] = useState(null) // { newCategory, prevCategory, affectedGigs }
  const [categorySaving, setCategorySaving] = useState(false)

  const saveFn = useCallback(
    async (patch) => { await updateVenue(venueId, patch) },
    [venueId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(
    saveFn,
    600,
    (patch) => outletCtx.onVenueUpdate?.(venueId, patch)
  )

  useEffect(() => {
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
  }, [venueId])

  useEffect(() => {
    listVenueContacts(venueId).then(setContacts).catch(() => setContacts([]))
  }, [venueId])

  async function handleAddContact(contact) {
    if (contacts.some((c) => c.id === contact.id)) return
    const linked = await addVenueContact(venueId, contact.id)
    setContacts((prev) => [...prev, linked])
  }

  async function handleSetPrimary(contactId, isPrimary) {
    await setVenueContactPrimary(venueId, contactId, isPrimary)
    setContacts((prev) =>
      prev.map((c) => ({
        ...c,
        is_primary: c.id === contactId ? isPrimary : false,
      })),
    )
  }

  async function handleRemoveContact(contactId) {
    await removeVenueContact(venueId, contactId)
    setContacts((prev) => prev.filter((c) => c.id !== contactId))
  }

  async function handleCategoryChangeCheck(newCategory, prevCategory) {
    try {
      const { affected_gigs: affectedGigs } = await getVenueCategoryImpact(venueId, newCategory)
      if (!affectedGigs.length) {
        schedule({ category: newCategory })
      } else {
        setCategoryChange({ newCategory, prevCategory, affectedGigs })
      }
    } catch {
      setForm((prev) => ({ ...prev, category: prevCategory }))
    }
  }

  async function handleCategoryConfirm(action) {
    const { newCategory } = categoryChange
    setCategoryChange(null)
    setCategorySaving(true)
    try {
      await updateVenue(venueId, { category: newCategory, on_affected_gigs: action })
      outletCtx.onVenueUpdate?.(venueId, { category: newCategory })
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
    if (field === 'category') {
      handleCategoryChangeCheck(value, form.category)
      return
    }
    if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
    schedule({ [field]: value || null })
  }

  async function handleDelete() {
    await deleteVenue(venueId)
    outletCtx.onVenueDelete?.(venueId)
    closeView()
  }

  async function handleBack() {
    await flush()
    closeView()
  }

  return (
    <>
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" fontWeight={600}>Venue</Typography>
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
        <>
          <Grid container spacing={2}>
            <VenueFields
              form={form}
              onChange={handleChange}
              errors={getRequiredErrors(form, REQUIRED_FIELDS)}
            />
          </Grid>

          <Divider sx={{ my: 3 }} />

          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
            Contacts
          </Typography>

          {contacts.map((c) => (
            <Box
              key={c.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 1,
                p: 1,
                pl: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <Chip label={c.category} size="small" variant="outlined" sx={{ alignSelf: 'center' }} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {c.name}{c.email ? ` (${c.email})` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {c.phone || ' '}
                </Typography>
              </Box>
              <Tooltip title={c.is_primary ? 'Primary contact — click to unset' : 'Mark as primary'}>
                <IconButton
                  size="small"
                  color={c.is_primary ? 'warning' : 'default'}
                  onClick={() => handleSetPrimary(c.id, !c.is_primary)}
                  aria-label={c.is_primary ? 'unset primary' : 'set primary'}
                >
                  {c.is_primary ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Open contact">
                <IconButton
                  size="small"
                  onClick={async () => { await flush(); navigate(`/contacts/${c.id}`) }}
                  aria-label="open contact"
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton
                size="small"
                onClick={() => handleRemoveContact(c.id)}
                aria-label="remove contact"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}

          <Box sx={{ mt: 1 }}>
            <ContactPicker
              onSelect={handleAddContact}
              excludeIds={contacts.map((c) => c.id)}
            />
          </Box>
        </>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <SaveStatusLabel status={categorySaving ? 'saving' : saveStatus} />
      </Box>

      <Box sx={{ mt: 4 }}>
        <Button color="error" variant="contained" onClick={() => setConfirmingDelete(true)}>
          Delete
        </Button>
      </Box>

      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)}>
        <DialogTitle>Delete venue?</DialogTitle>
        <DialogContent>
          <DialogContentText>This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>

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
