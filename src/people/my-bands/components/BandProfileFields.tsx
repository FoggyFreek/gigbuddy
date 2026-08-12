import { useTranslation } from 'react-i18next'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import CountrySelect from '../../../components/shared/CountrySelect.tsx'
import type { BandProfileForm } from './bandProfileForm.ts'

interface BandProfileFieldsProps {
  form: BandProfileForm
  onChange: (field: keyof BandProfileForm, value: string) => void
  errors: Partial<Record<keyof BandProfileForm, string>>
  disabled?: boolean
  /**
   * Fires when the website field loses focus — the first moment a duplicate
   * check on the website can produce an answer, since the name search is long
   * over by then.
   */
  onWebsiteBlur?: () => void
}

// Shared by the create dialog and the edit modal so the two cannot drift.
export default function BandProfileFields({
  form, onChange, errors, disabled = false, onWebsiteBlur,
}: Readonly<BandProfileFieldsProps>) {
  const { t } = useTranslation('myBands')

  return (
    <Grid container spacing={2}>
      <Grid size={12}>
        <TextField
          label={t($ => $.fields.name)}
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          error={Boolean(errors.name)}
          helperText={errors.name}
          disabled={disabled}
          required
          fullWidth
        />
      </Grid>
      <Grid size={12}>
        <CountrySelect
          label={t($ => $.fields.country)}
          value={form.countryCode}
          onChange={(code) => onChange('countryCode', code)}
          error={Boolean(errors.countryCode)}
          helperText={errors.countryCode}
          disabled={disabled}
          required
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label={t($ => $.fields.spotify)}
          value={form.spotifyUrl}
          onChange={(e) => onChange('spotifyUrl', e.target.value)}
          error={Boolean(errors.spotifyUrl)}
          helperText={errors.spotifyUrl ?? t($ => $.fields.spotifyHint)}
          disabled={disabled}
          placeholder="https://open.spotify.com/artist/…"
          fullWidth
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label={t($ => $.fields.website)}
          value={form.websiteUrl}
          onChange={(e) => onChange('websiteUrl', e.target.value)}
          onBlur={onWebsiteBlur}
          error={Boolean(errors.websiteUrl)}
          helperText={errors.websiteUrl ?? t($ => $.fields.linkHint)}
          disabled={disabled}
          placeholder="https://…"
          fullWidth
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label={t($ => $.fields.contactEmail)}
          value={form.contactEmail}
          onChange={(e) => onChange('contactEmail', e.target.value)}
          error={Boolean(errors.contactEmail)}
          helperText={errors.contactEmail ?? t($ => $.fields.contactEmailHint)}
          disabled={disabled}
          fullWidth
        />
      </Grid>
    </Grid>
  )
}
