import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CopyAdornment from '../../../components/CopyAdornment.tsx'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'

export interface VenueForm {
  category?: string
  name?: string
  title?: string
  given_name?: string
  family_name?: string
  organization_name?: string
  kvk_number?: string
  tax_id?: string
  street_and_number?: string
  street_additional?: string
  postal_code?: string
  city?: string
  region?: string
  country?: string
  website?: string
  phone?: string
  email?: string
  [key: string]: unknown
}

/**
 * `form` is the add/edit dialog's order (identity first, then address).
 * The detail page splits the same fields over two tabs: `detail` is its
 * Information tab (name and address), `invoicing` the billing identity.
 */
export type VenueFieldsVariant = 'form' | 'detail' | 'invoicing'

interface VenueFieldsProps {
  form: VenueForm
  onChange: (field: string, value: string) => void
  errors?: Record<string, string | undefined>
  lockedCategory?: string
  disabled?: boolean
  /**
   * Replaces the plain name input, so a caller can drop in a richer control (the
   * add dialog uses a place search field). Keeps this component free of any
   * lookup coupling; without it the ordinary text field renders.
   */
  nameField?: ReactNode
  variant?: VenueFieldsVariant
}

// One cell per field, in visual order: [field, wide span, compact span]. The
// compact span applies below `sm` AND inside a SplitView pane (useCompactLayout),
// where a wide viewport still leaves the form only part of the screen — three
// fields on one row would be unreadable there. `category` drops out when the
// caller locks it; every other row keeps its widths.
type FieldCell = [field: string, wide: number, compact: number]

const FORM_LAYOUT: FieldCell[] = [
  ['category', 4, 12], ['name', 8, 12],
  ['title', 3, 4], ['given_name', 4, 8], ['family_name', 5, 12],
  ['organization_name', 12, 12],
  ['kvk_number', 6, 12], ['tax_id', 6, 12],
  ['street_and_number', 8, 12], ['postal_code', 4, 6],
  ['street_additional', 12, 12],
  ['city', 5, 12], ['region', 4, 6], ['country', 3, 6],
  ['website', 12, 12],
  ['phone', 6, 12], ['email', 6, 12],
]

const DETAIL_LAYOUT: FieldCell[] = [
  ['category', 4, 12], ['name', 8, 12],
  ['street_and_number', 5, 12], ['street_additional', 4, 12], ['postal_code', 3, 6],
  ['city', 5, 12], ['region', 4, 6], ['country', 3, 6],
  ['website', 6, 12], ['phone', 3, 12], ['email', 3, 12],
]

// Who the invoice is actually addressed to, and the numbers it must carry.
const INVOICING_LAYOUT: FieldCell[] = [
  ['title', 3, 4], ['given_name', 4, 8], ['family_name', 5, 12],
  ['organization_name', 12, 12],
  ['kvk_number', 6, 12], ['tax_id', 6, 12],
]

const LAYOUTS: Record<VenueFieldsVariant, FieldCell[]> = {
  form: FORM_LAYOUT,
  detail: DETAIL_LAYOUT,
  invoicing: INVOICING_LAYOUT,
}

export default function VenueFields({
  form,
  onChange,
  errors = {},
  lockedCategory,
  disabled = false,
  nameField,
  variant = 'form',
}: Readonly<VenueFieldsProps>) {
  const { t } = useTranslation('venues')
  const isCompact = useCompactLayout()
  const isFestival = form.category === 'festival'

  // A plain text cell — the shape almost every field takes.
  const text = (
    field: string,
    label: string,
    extra: { placeholder?: string; type?: string; copy?: boolean; maxLength?: number } = {},
  ) => (
    <TextField
      label={label}
      fullWidth
      type={extra.type}
      value={form[field] ?? ''}
      onChange={(e) => onChange(field, e.target.value)}
      placeholder={extra.placeholder}
      slotProps={{
        htmlInput: { readOnly: disabled, ...(extra.maxLength ? { maxLength: extra.maxLength } : {}) },
        ...(extra.copy ? { input: { endAdornment: <CopyAdornment value={form[field] as string} /> } } : {}),
      }}
    />
  )

  const fields: Record<string, () => ReactNode> = {
    category: () => (
      <FormControl fullWidth>
        <InputLabel>{t($ => $.fields.category)}</InputLabel>
        <Select
          label={t($ => $.fields.category)}
          value={form.category}
          onChange={(e) => onChange('category', e.target.value)}
          disabled={disabled}
        >
          <MenuItem value="venue">{t($ => $.category.venue)}</MenuItem>
          <MenuItem value="festival">{t($ => $.category.festival)}</MenuItem>
        </Select>
      </FormControl>
    ),
    name: () => nameField ?? (
      <TextField
        label={isFestival ? t($ => $.fields.festivalName) : t($ => $.fields.venueName)}
        fullWidth
        required
        value={form.name}
        onChange={(e) => onChange('name', e.target.value)}
        error={!!errors.name}
        helperText={errors.name}
        slotProps={{ htmlInput: { readOnly: disabled } }}
      />
    ),
    title: () => text('title', t($ => $.fields.title), { placeholder: t($ => $.placeholders.title) }),
    given_name: () => text('given_name', t($ => $.fields.givenName)),
    family_name: () => text('family_name', t($ => $.fields.familyName)),
    organization_name: () => text('organization_name', t($ => $.fields.organizationName)),
    kvk_number: () => text('kvk_number', t($ => $.fields.kvkNumber), { copy: true }),
    tax_id: () => text('tax_id', t($ => $.fields.taxId), { copy: true }),
    street_and_number: () => text('street_and_number', t($ => $.fields.streetAndNumber)),
    street_additional: () => text('street_additional', t($ => $.fields.streetAdditional), {
      placeholder: t($ => $.placeholders.streetAdditional),
    }),
    postal_code: () => text('postal_code', t($ => $.fields.postalCode), {
      placeholder: t($ => $.placeholders.postalCode),
    }),
    city: () => text('city', t($ => $.fields.city)),
    region: () => text('region', t($ => $.fields.region), { placeholder: t($ => $.placeholders.region) }),
    country: () => (
      <TextField
        label={t($ => $.fields.country)}
        fullWidth
        value={form.country}
        onChange={(e) => onChange('country', e.target.value.slice(0, 2).toUpperCase())}
        slotProps={{ htmlInput: { maxLength: 2, readOnly: disabled } }}
        placeholder={t($ => $.placeholders.country)}
      />
    ),
    website: () => (
      <TextField
        label={t($ => $.fields.website)}
        fullWidth
        value={form.website}
        onChange={(e) => onChange('website', e.target.value)}
        placeholder={t($ => $.placeholders.website)}
        slotProps={{
          htmlInput: { readOnly: disabled },
          input: {
            endAdornment: form.website ? (
              <InputAdornment position="end">
                <Tooltip title={t($ => $.openInNewTab)}>
                  <IconButton
                    size="small"
                    edge="end"
                    tabIndex={-1}
                    component="a"
                    href={form.website as string}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ) : null,
          },
        }}
      />
    ),
    phone: () => text('phone', t($ => $.fields.phone), { copy: true }),
    email: () => text('email', t($ => $.fields.email), { type: 'email', copy: true }),
  }

  const layout = LAYOUTS[variant]

  return (
    <>
      {layout
        .filter(([field]) => !(field === 'category' && lockedCategory))
        .map(([field, wide, compact]) => (
          <Grid key={field} size={isCompact ? compact : wide}>{fields[field]()}</Grid>
        ))}
    </>
  )
}
