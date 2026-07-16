import type { Venue, Id } from '../types/entities.ts'
import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { checkVenueDuplicates, createVenue, getVenueCategoryImpact, getVenue, updateVenue } from '../api/venues.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import SaveStatusLabel from './SaveStatusLabel.tsx'
import VenueFields from './VenueFields.tsx'
import type { VenueForm } from './VenueFields.tsx'
import type { DuplicateEntityMatch } from '../types/entities.ts'

const REQUIRED_FIELDS = ['name']

const EMPTY_FORM: VenueForm = {
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

interface AffectedGig {
  id?: Id
  event_description?: string
  event_date?: string
}

interface CategoryChange {
  newCategory: string
  prevCategory: string
  affectedGigs: AffectedGig[]
}

interface VenueFormModalProps {
  mode: 'create' | 'edit'
  venueId?: Id
  onClose: () => void
  onDelete?: () => void
  initial?: Partial<VenueForm>
  onCreated?: (venue: Venue) => void
  lockedCategory?: string
}

export default function VenueFormModal({ mode, venueId, onClose, onDelete, initial, onCreated, lockedCategory }: Readonly<VenueFormModalProps>) {
  const { t } = useTranslation(['venues', 'common'])
  const categoryLabel = (category: string) =>
    category === 'festival' ? t($ => $.category.festival) : t($ => $.category.venue)
  const [form, setForm] = useState<VenueForm>(() => ({ ...EMPTY_FORM, ...initial }))
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [categoryChange, setCategoryChange] = useState<CategoryChange | null>(null)
  const [categorySaving, setCategorySaving] = useState(false)
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateEntityMatch[]>([])
  const { canWritePlanning: canWrite } = usePermissions()

  const saveFn = useCallback(
    async (patch: Record<string, unknown>) => {
      await (updateVenue as unknown as (id: Id, body: Record<string, unknown>) => Promise<Venue>)(venueId!, patch)
    },
    [venueId],
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    if (mode !== 'edit') return
    getVenue(venueId!)
      .then((v) => {
        setForm({
          category: v.category || 'venue',
          name: v.name || '',
          title: (v as Record<string, unknown>).title as string || '',
          given_name: (v as Record<string, unknown>).given_name as string || '',
          family_name: (v as Record<string, unknown>).family_name as string || '',
          organization_name: v.organization_name || '',
          street_and_number: (v as Record<string, unknown>).street_and_number as string || '',
          street_additional: (v as Record<string, unknown>).street_additional as string || '',
          postal_code: v.postal_code || '',
          city: v.city || '',
          region: v.region || '',
          country: v.country ? String(v.country).trim() : '',
          website: (v as Record<string, unknown>).website as string || '',
          phone: (v as Record<string, unknown>).phone as string || '',
          email: (v as Record<string, unknown>).email as string || '',
        })
      })
      .finally(() => setLoading(false))
  }, [mode, venueId])

  useEffect(() => {
    if (mode !== 'create') return
    const hasMatchableInput = Boolean(
      form.organization_name?.trim()
      || form.street_and_number?.trim()
      || form.website?.trim()
      || form.email?.trim(),
    )
    if (!hasMatchableInput) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void checkVenueDuplicates({
        organization_name: form.organization_name,
        street_and_number: form.street_and_number,
        website: form.website,
        email: form.email,
      }, { signal: controller.signal })
        .then((result) => setDuplicateMatches(result.items))
        .catch(() => {
          if (!controller.signal.aborted) setDuplicateMatches([])
        })
    }, 400)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [mode, form.organization_name, form.street_and_number, form.website, form.email])

  async function handleCategoryChangeCheck(newCategory: string, prevCategory: string) {
    try {
      const impact = await getVenueCategoryImpact(venueId!, newCategory) as Record<string, unknown>
      const affectedGigs = (impact.affected_gigs as AffectedGig[] | undefined) ?? []
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

  async function handleCategoryConfirm(action: string) {
    const { newCategory } = categoryChange!
    setCategoryChange(null)
    setCategorySaving(true)
    try {
      await (updateVenue as unknown as (id: Id, body: Record<string, unknown>) => Promise<Venue>)(
        venueId!, { category: newCategory, on_affected_gigs: action }
      )
    } finally {
      setCategorySaving(false)
    }
  }

  function handleCategoryCancel() {
    setForm((prev) => ({ ...prev, category: categoryChange!.prevCategory }))
    setCategoryChange(null)
  }

  function handleChange(field: string, value: string) {
    if (mode === 'edit' && !canWrite) return
    setDuplicateMatches([])
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') {
      if (field === 'category') {
        handleCategoryChangeCheck(value, form.category as string)
        return
      }
      if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
      schedule({ [field]: value || null })
    }
  }

  async function handleCreate() {
    const errs: Record<string, string> = {}
    if (!form.name?.trim()) errs.name = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    // The server accepts many detail fields (title, given_name, etc.) that are
    // not in the canonical Partial<Venue> display type — cast via unknown.
    const venue = await (createVenue as unknown as (body: Record<string, unknown>) => Promise<Venue>)({
      category: form.category,
      name: form.name?.trim(),
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
      <DialogTitle>{mode === 'create' ? t($ => $.modal.addTitle) : t($ => $.detailTitle)}</DialogTitle>

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
              disabled={mode === 'edit' && !canWrite}
            />
          </Grid>
          {duplicateMatches.map((match) => (
            <Alert severity="info" key={String(match.id)} sx={{ mt: 2 }}>
              {t($ => $.modal.duplicateWarning)}{' '}
              <Link component={RouterLink} to={`/venues/${match.id}`} onClick={onClose}>
                {match.name}
              </Link>.
            </Alert>
          ))}
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && <SaveStatusLabel status={categorySaving ? 'saving' : saveStatus} />}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {(() => {
          if (mode === 'create') {
            return (
              <>
                <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
                <Button variant="contained" onClick={handleCreate}>{t($ => $.modal.addTitle)}</Button>
              </>
            )
          }
          if (confirmingDelete) {
            return (
              <>
                <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
                  {t($ => $.modal.confirmDelete)}
                </Typography>
                <Button onClick={() => setConfirmingDelete(false)}>{t($ => $.common.actions.cancel)}</Button>
                <Button color="error" variant="contained" onClick={onDelete}>{t($ => $.common.actions.delete)}</Button>
              </>
            )
          }
          return (
            <>
              {canWrite && <Button color="error" onClick={() => setConfirmingDelete(true)}>{t($ => $.common.actions.delete)}</Button>}
              <Box sx={{ flexGrow: 1 }} />
              <Button variant="contained" onClick={handleClose}>{t($ => $.common.actions.close)}</Button>
            </>
          )
        })()}
      </DialogActions>
    </Dialog>

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
                  {g.event_description || t($ => $.categoryChange.untitled)} — {String(g.event_date ?? '').slice(0, 10)}
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
