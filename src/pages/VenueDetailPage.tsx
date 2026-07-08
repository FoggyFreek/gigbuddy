import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
} from '../api/venues.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import PlanningReadOnlyAlert from '../components/PlanningReadOnlyAlert.tsx'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import ContactPicker from '../components/ContactPicker.tsx'
import SaveStatusLabel from '../components/SaveStatusLabel.tsx'
import VenueFields from '../components/VenueFields.tsx'
import type { VenueForm } from '../components/VenueFields.tsx'
import type { Venue, Contact, Id } from '../types/entities.ts'

interface VenueDetailOutletContext {
  insideSplitView?: boolean
  onClose?: () => void
  onVenueUpdate?: (id: Id, patch: Partial<Venue>) => void
  onVenueDelete?: (id: Id) => void
}

interface CategoryChange {
  newCategory: string
  prevCategory: string
  affectedGigs: Array<{ id: Id; event_description?: string; event_date?: string }>
}

const REQUIRED_FIELDS = ['name']

export default function VenueDetailPage() {
  const { t } = useTranslation(['venues', 'common'])
  const categoryLabel = (category: string) =>
    category === 'festival' ? t($ => $.category.festival) : t($ => $.category.venue)
  const { id } = useParams()
  const venueId = Number(id)
  const navigate = useNavigate()
  const { canWritePlanning: canWrite } = usePermissions()
  const outletCtx = (useOutletContext<VenueDetailOutletContext>() || {}) as VenueDetailOutletContext
  const insideSplitView = !!outletCtx.insideSplitView

  function closeView() {
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  const [form, setForm] = useState<VenueForm>({
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
  const [contacts, setContacts] = useState<(Contact & { is_primary?: boolean })[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [categoryChange, setCategoryChange] = useState<CategoryChange | null>(null)
  const [categorySaving, setCategorySaving] = useState(false)

  const saveFn = useCallback(
    async (patch: Partial<VenueForm>) => { await updateVenue(venueId, patch as Partial<Venue>) },
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
        const venue = v as Record<string, unknown>
        setForm({
          category: String(venue.category || 'venue'),
          name: String(venue.name || ''),
          title: String(venue.title || ''),
          given_name: String(venue.given_name || ''),
          family_name: String(venue.family_name || ''),
          organization_name: String(venue.organization_name || ''),
          street_and_number: String(venue.street_and_number || ''),
          street_additional: String(venue.street_additional || ''),
          postal_code: String(venue.postal_code || ''),
          city: String(venue.city || ''),
          region: String(venue.region || ''),
          country: venue.country ? String(venue.country).trim() : '',
          website: String(venue.website || ''),
          phone: String(venue.phone || ''),
          email: String(venue.email || ''),
        })
      })
      .finally(() => setLoading(false))
  }, [venueId])

  useEffect(() => {
    listVenueContacts(venueId).then((c) => setContacts(c as (Contact & { is_primary?: boolean })[])).catch(() => setContacts([]))
  }, [venueId])

  async function handleAddContact(contact: Contact) {
    if (!canWrite) return
    if (contacts.some((c) => c.id === contact.id)) return
    const linked = await addVenueContact(venueId, contact.id!)
    setContacts((prev) => [...prev, linked as (Contact & { is_primary?: boolean })])
  }

  async function handleSetPrimary(contactId: Id, isPrimary: boolean) {
    if (!canWrite) return
    await setVenueContactPrimary(venueId, contactId, isPrimary)
    setContacts((prev) =>
      prev.map((c) => ({
        ...c,
        is_primary: c.id === contactId ? isPrimary : false,
      })),
    )
  }

  async function handleRemoveContact(contactId: Id) {
    if (!canWrite) return
    await removeVenueContact(venueId, contactId)
    setContacts((prev) => prev.filter((c) => c.id !== contactId))
  }

  async function handleCategoryChangeCheck(newCategory: string, prevCategory: string) {
    try {
      const result = await getVenueCategoryImpact(venueId, newCategory) as { affected_gigs: CategoryChange['affectedGigs'] }
      const affectedGigs = result.affected_gigs
      if (!affectedGigs.length) {
        schedule({ category: newCategory } as Partial<VenueForm>)
      } else {
        setCategoryChange({ newCategory, prevCategory, affectedGigs })
      }
    } catch {
      setForm((prev) => ({ ...prev, category: prevCategory }))
    }
  }

  async function handleCategoryConfirm(action: string) {
    if (!categoryChange) return
    const { newCategory } = categoryChange
    setCategoryChange(null)
    setCategorySaving(true)
    try {
      await updateVenue(venueId, { category: newCategory, on_affected_gigs: action } as Partial<Venue>)
      outletCtx.onVenueUpdate?.(venueId, { category: newCategory })
    } finally {
      setCategorySaving(false)
    }
  }

  function handleCategoryCancel() {
    if (!categoryChange) return
    setForm((prev) => ({ ...prev, category: categoryChange.prevCategory }))
    setCategoryChange(null)
  }

  function handleChange(field: string, value: string) {
    if (!canWrite) return
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field === 'category') {
      handleCategoryChangeCheck(value, form.category ?? '')
      return
    }
    if (hasRequiredErrors({ ...form, [field]: value } as Record<string, unknown>, REQUIRED_FIELDS)) return
    schedule({ [field]: value || null } as Partial<VenueForm>)
  }

  async function handleDelete() {
    setConfirmingDelete(false)
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
          <IconButton onClick={handleBack} aria-label={t($ => $.aria.back, { ns: 'common' })}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>{t($ => $.detailTitle)}</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={handleBack} aria-label={t($ => $.aria.close, { ns: 'common' })}>
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      <PlanningReadOnlyAlert canWrite={canWrite} />

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
              errors={getRequiredErrors(form as Record<string, unknown>, REQUIRED_FIELDS)}
              disabled={!canWrite}
            />
          </Grid>

          <Divider sx={{ my: 3 }} />

          <Typography variant="subtitle2" sx={{ fontWeight: 600,  mb: 2  }}>
            {t($ => $.detail.contactsHeading)}
          </Typography>

          {contacts.map((c) => (
            <Box
              key={String(c.id)}
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
                  {c.phone || ' '}
                </Typography>
              </Box>
              {canWrite && (
                <Tooltip title={c.is_primary ? t($ => $.detail.primarySet) : t($ => $.detail.primaryMark)}>
                  <IconButton
                    size="small"
                    color={c.is_primary ? 'warning' : 'default'}
                    onClick={() => handleSetPrimary(c.id!, !c.is_primary)}
                    aria-label={c.is_primary ? t($ => $.detail.unsetPrimaryAria) : t($ => $.detail.setPrimaryAria)}
                  >
                    {c.is_primary ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={t($ => $.detail.openContact)}>
                <IconButton
                  size="small"
                  onClick={async () => { await flush(); navigate(`/contacts/${c.id}`) }}
                  aria-label={t($ => $.detail.openContactAria)}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {canWrite && (
                <IconButton
                  size="small"
                  onClick={() => handleRemoveContact(c.id!)}
                  aria-label={t($ => $.detail.removeContactAria)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          ))}

          {canWrite && (
            <Box sx={{ mt: 1 }}>
              <ContactPicker
                onSelect={handleAddContact}
                excludeIds={contacts.map((c) => c.id).filter((id): id is Id => id !== undefined)}
              />
            </Box>
          )}
        </>
      )}

      {canWrite && (
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
          <SaveStatusLabel status={categorySaving ? 'saving' : saveStatus} />
        </Box>
      )}

      {canWrite && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => setConfirmingDelete(true)}>
            {t($ => $.common.actions.delete)}
          </Button>
        </Box>
      )}

      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)}>
        <DialogTitle>{t($ => $.detail.deleteTitle)}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t($ => $.confirmation.cannotUndo, { ns: 'common' })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingDelete(false)}>{t($ => $.common.actions.cancel)}</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>{t($ => $.common.actions.delete)}</Button>
        </DialogActions>
      </Dialog>
    </Box>

    {categoryChange && (
      <Dialog open onClose={handleCategoryCancel} maxWidth="sm" fullWidth>
        <DialogTitle>
          {t($ => $.categoryChange.title, { count: categoryChange.affectedGigs.length })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            <Trans
              t={t}
              i18nKey={$ => $.categoryChange.body}
              count={categoryChange.affectedGigs.length}
              values={{
                prevCategory: categoryLabel(categoryChange.prevCategory),
                newCategory: categoryLabel(categoryChange.newCategory),
              }}
              components={{ strong: <strong /> }}
            />
          </Typography>
          <Box component="ul" sx={{ pl: 2, mt: 1, mb: 2 }}>
            {categoryChange.affectedGigs.map((g) => (
              <li key={String(g.id)}>
                <Typography variant="body2">
                  {g.event_description || t($ => $.categoryChange.untitled)} — {String(g.event_date).slice(0, 10)}
                </Typography>
              </li>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary">
            <Trans
              t={t}
              i18nKey={$ => $.categoryChange.actions}
              values={{ category: categoryLabel(categoryChange.newCategory) }}
              components={{ strong: <strong />, br: <br /> }}
            />
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCategoryCancel}>{t($ => $.common.actions.cancel)}</Button>
          <Button onClick={() => handleCategoryConfirm('remove')}>{t($ => $.categoryChange.removeButton)}</Button>
          <Button variant="contained" onClick={() => handleCategoryConfirm('migrate')}>
            {t($ => $.categoryChange.moveButton)}
          </Button>
        </DialogActions>
      </Dialog>
    )}
    </>
  )
}
