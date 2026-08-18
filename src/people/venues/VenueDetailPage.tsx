import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useOutletContext, useParams } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import CloseIcon from '@mui/icons-material/Close'
import ContactsIcon from '@mui/icons-material/Contacts'
import DeleteIcon from '@mui/icons-material/Delete'
import DiamondOutlined from '@mui/icons-material/DiamondOutlined'
import FestivalIcon from '@mui/icons-material/Festival'
import InfoIcon from '@mui/icons-material/Info'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import type { SvgIconComponent } from '@mui/icons-material'
import {
  addVenueContact,
  deleteVenue,
  enrichVenue,
  getVenue,
  getVenueCategoryImpact,
  listVenueContacts,
  removeVenueContact,
  setVenueContactPrimary,
  updateVenue,
} from './venues.ts'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import { useEntitlements } from '../../hooks/useEntitlements.ts'
import { FEATURES } from '../../auth/entitlements.ts'
import FloatingTabs from '../../components/FloatingTabs.tsx'
import PlanningReadOnlyAlert from '../../components/PlanningReadOnlyAlert.tsx'
import { getRequiredErrors, hasRequiredErrors } from '../../utils/requiredFields.ts'
import ContactPicker from '../contacts/components/ContactPicker.tsx'
import SaveStatusLabel from '../../components/SaveStatusLabel.tsx'
import PlaceEnrichDialog from '../../components/shared/PlaceEnrichDialog.tsx'
import VenueEventsList from './components/VenueEventsList.tsx'
import VenueFields from './components/VenueFields.tsx'
import VenueLocationHeader from './components/VenueLocationHeader.tsx'
import type { VenueForm } from './components/VenueFields.tsx'
import type { Venue, Contact, Id } from '../../types/entities.ts'
import type { PlaceSuggestion } from '../../types/api.ts'
import { useDialog } from '../../contexts/dialogContext.ts'

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

type VenueTabKey = 'information' | 'invoicing' | 'contacts' | 'events'

// Each panel repeats its tab's tooltip as a heading, so the section is named
// once the pill's icon is no longer hovered.
function TabHeading({ children }: Readonly<{ children: ReactNode }>) {
  return <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>{children}</Typography>
}

const TABS: { key: VenueTabKey; Icon: SvgIconComponent }[] = [
  { key: 'information', Icon: InfoIcon },
  { key: 'invoicing', Icon: ReceiptLongIcon },
  { key: 'contacts', Icon: ContactsIcon },
  { key: 'events', Icon: FestivalIcon },
]

export default function VenueDetailPage() {
  const { t } = useTranslation(['venues', 'common'])
  const { confirmDelete } = useDialog()
  const categoryLabel = (category: string) =>
    category === 'festival' ? t($ => $.category.festival) : t($ => $.category.venue)
  const { id } = useParams()
  const venueId = Number(id)
  const navigate = useNavigate()
  const { canWritePlanning: canWrite } = usePermissions()
  // The place lookup is metered and paid; manual editing below is not gated.
  const hasPlaceLookup = useEntitlements().has(FEATURES.INTEGRATIONS)
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
  // Stored coordinates, when the venue has them — the header map falls back to
  // geocoding the address fields otherwise.
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  })
  const [contacts, setContacts] = useState<(Contact & { is_primary?: boolean })[]>([])
  const [activeTab, setActiveTab] = useState<VenueTabKey>('information')
  const [loading, setLoading] = useState(true)
  const [categoryChange, setCategoryChange] = useState<CategoryChange | null>(null)
  const [categorySaving, setCategorySaving] = useState(false)
  const [enriching, setEnriching] = useState(false)

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
        setCoords({
          latitude: typeof venue.latitude === 'number' ? venue.latitude : Number(venue.latitude) || null,
          longitude: typeof venue.longitude === 'number' ? venue.longitude : Number(venue.longitude) || null,
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

  const tabs = useMemo(
    () => TABS.map(({ key, Icon }) => ({ key, Icon, label: t($ => $.detail.tabs[key]) })),
    [t],
  )

  // Labels for the generic enrich dialog. Order follows the form's visual order.
  const enrichFields = useMemo(() => [
    { key: 'street_and_number', label: t($ => $.fields.streetAndNumber) },
    { key: 'postal_code', label: t($ => $.fields.postalCode) },
    { key: 'city', label: t($ => $.fields.city) },
    { key: 'region', label: t($ => $.fields.region) },
    { key: 'country', label: t($ => $.fields.country) },
    { key: 'website', label: t($ => $.fields.website) },
    { key: 'phone', label: t($ => $.fields.phone) },
  ], [t])

  // The server decides what actually gets filled (it re-checks the stored row),
  // so the response, not the suggestion, is what we merge back into the form.
  async function handleEnrichApply(suggestion: PlaceSuggestion) {
    if (!canWrite) return
    await flush()
    const { venue } = await enrichVenue(venueId, suggestion)
    const row = venue as Record<string, unknown>
    setForm((prev) => {
      const next = { ...prev }
      for (const { key } of enrichFields) next[key] = String(row[key] ?? '')
      return next
    })
    outletCtx.onVenueUpdate?.(venueId, venue)
    setEnriching(false)
  }

  async function handleDelete() {
    if (!await confirmDelete({ title: t($ => $.detail.deleteTitle) })) return
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
        <Box sx={{ flexGrow: 1 }} />
        {canWrite && !loading && !hasPlaceLookup && (
          <Tooltip title={t($ => $.common.premium.tooltip)} describeChild>
            <Button
              size="small"
              color="secondary"
              component={RouterLink}
              to={`/upgrade/${FEATURES.INTEGRATIONS}`}
              startIcon={<DiamondOutlined />}
            >
              {t($ => $.detail.enrichButton)}
            </Button>
          </Tooltip>
        )}
        {canWrite && !loading && hasPlaceLookup && (
          <Tooltip title={form.name?.trim() ? t($ => $.detail.enrichTooltip) : t($ => $.detail.enrichNeedsName)}>
            <span>
              <Button
                size="small"
                startIcon={<AutoFixHighIcon />}
                onClick={() => setEnriching(true)}
                disabled={!form.name?.trim()}
              >
                {t($ => $.detail.enrichButton)}
              </Button>
            </span>
          </Tooltip>
        )}
        {insideSplitView && (
          <IconButton onClick={handleBack} aria-label={t($ => $.aria.close, { ns: 'common' })}>
            <CloseIcon />
          </IconButton>
        )}
      </Box>

      <PlanningReadOnlyAlert canWrite={canWrite} />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <VenueLocationHeader form={form} latitude={coords.latitude} longitude={coords.longitude} />

          {/* Floating pill overlapping the map, splitting the body into three
              sections. Panels stay mounted (toggled via `display`) so the
              debounced form and the loaded event page survive a tab switch. */}
          <FloatingTabs tabs={tabs} value={activeTab} onChange={setActiveTab} />

          <Box sx={{ display: activeTab === 'information' ? 'block' : 'none' }}>
            <TabHeading>{t($ => $.detail.tabs.information)}</TabHeading>
            <Grid container spacing={2}>
              <VenueFields
                variant="detail"
                form={form}
                onChange={handleChange}
                errors={getRequiredErrors(form as Record<string, unknown>, REQUIRED_FIELDS)}
                disabled={!canWrite}
              />
            </Grid>
          </Box>

          <Box sx={{ display: activeTab === 'invoicing' ? 'block' : 'none' }}>
            <TabHeading>{t($ => $.detail.tabs.invoicing)}</TabHeading>
            <Grid container spacing={2}>
              <VenueFields
                variant="invoicing"
                form={form}
                onChange={handleChange}
                disabled={!canWrite}
              />
            </Grid>
          </Box>

          <Box sx={{ display: activeTab === 'events' ? 'block' : 'none' }}>
            <TabHeading>{t($ => $.detail.tabs.events)}</TabHeading>
            <VenueEventsList venueId={venueId} active={activeTab === 'events'} onBeforeNavigate={flush} />
          </Box>

          <Box sx={{ display: activeTab === 'contacts' ? 'block' : 'none' }}>
          <TabHeading>{t($ => $.detail.tabs.contacts)}</TabHeading>
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
          </Box>
        </>
      )}

      {canWrite && (
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
          <SaveStatusLabel status={categorySaving ? 'saving' : saveStatus} />
        </Box>
      )}

      {canWrite && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => { void handleDelete() }}>
            {t($ => $.common.actions.delete)}
          </Button>
        </Box>
      )}

    </Box>

    {enriching && (
      <PlaceEnrichDialog
        query={form.name ?? ''}
        current={form as Record<string, unknown>}
        fields={enrichFields}
        country={form.country ?? null}
        city={form.city ?? null}
        onApply={handleEnrichApply}
        onClose={() => setEnriching(false)}
      />
    )}

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
