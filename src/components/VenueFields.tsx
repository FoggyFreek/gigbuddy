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
import CopyAdornment from './CopyAdornment.tsx'

export interface VenueForm {
  category?: string
  name?: string
  title?: string
  given_name?: string
  family_name?: string
  organization_name?: string
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

interface VenueFieldsProps {
  form: VenueForm
  onChange: (field: string, value: string) => void
  errors?: Record<string, string | undefined>
  lockedCategory?: string
  disabled?: boolean
}

export default function VenueFields({ form, onChange, errors = {}, lockedCategory, disabled = false }: Readonly<VenueFieldsProps>) {
  const { t } = useTranslation('venues')
  const isFestival = form.category === 'festival'
  return (
    <>
      {!lockedCategory && (
        <Grid size={4}>
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
        </Grid>
      )}
      <Grid size={8}>
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
      </Grid>

      <Grid size={3}>
        <TextField
          label={t($ => $.fields.title)}
          fullWidth
          value={form.title}
          onChange={(e) => onChange('title', e.target.value)}
          placeholder={t($ => $.placeholders.title)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>
      <Grid size={4}>
        <TextField
          label={t($ => $.fields.givenName)}
          fullWidth
          value={form.given_name}
          onChange={(e) => onChange('given_name', e.target.value)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>
      <Grid size={5}>
        <TextField
          label={t($ => $.fields.familyName)}
          fullWidth
          value={form.family_name}
          onChange={(e) => onChange('family_name', e.target.value)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>

      <Grid size={12}>
        <TextField
          label={t($ => $.fields.organizationName)}
          fullWidth
          value={form.organization_name}
          onChange={(e) => onChange('organization_name', e.target.value)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>

      <Grid size={8}>
        <TextField
          label={t($ => $.fields.streetAndNumber)}
          fullWidth
          value={form.street_and_number}
          onChange={(e) => onChange('street_and_number', e.target.value)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>
      <Grid size={4}>
        <TextField
          label={t($ => $.fields.postalCode)}
          fullWidth
          value={form.postal_code}
          onChange={(e) => onChange('postal_code', e.target.value)}
          placeholder={t($ => $.placeholders.postalCode)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label={t($ => $.fields.streetAdditional)}
          fullWidth
          value={form.street_additional}
          onChange={(e) => onChange('street_additional', e.target.value)}
          placeholder={t($ => $.placeholders.streetAdditional)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>

      <Grid size={5}>
        <TextField
          label={t($ => $.fields.city)}
          fullWidth
          value={form.city}
          onChange={(e) => onChange('city', e.target.value)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>
      <Grid size={4}>
        <TextField
          label={t($ => $.fields.region)}
          fullWidth
          value={form.region}
          onChange={(e) => onChange('region', e.target.value)}
          placeholder={t($ => $.placeholders.region)}
          slotProps={{ htmlInput: { readOnly: disabled } }}
        />
      </Grid>
      <Grid size={3}>
        <TextField
          label={t($ => $.fields.country)}
          fullWidth
          value={form.country}
          onChange={(e) => onChange('country', e.target.value.slice(0, 2).toUpperCase())}
          slotProps={{ htmlInput: { maxLength: 2, readOnly: disabled } }}
          placeholder={t($ => $.placeholders.country)}
        />
      </Grid>

      <Grid size={12}>
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
      </Grid>
      <Grid size={6}>
        <TextField
          label={t($ => $.fields.phone)}
          fullWidth
          value={form.phone}
          onChange={(e) => onChange('phone', e.target.value)}
          slotProps={{ htmlInput: { readOnly: disabled }, input: { endAdornment: <CopyAdornment value={form.phone as string} /> } }}
        />
      </Grid>
      <Grid size={6}>
        <TextField
          label={t($ => $.fields.email)}
          fullWidth
          type="email"
          value={form.email}
          onChange={(e) => onChange('email', e.target.value)}
          slotProps={{ htmlInput: { readOnly: disabled }, input: { endAdornment: <CopyAdornment value={form.email as string} /> } }}
        />
      </Grid>
    </>
  )
}
