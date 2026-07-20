import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProfileForm } from './profileForm.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Grid from '@mui/material/Grid'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import EditIcon from '@mui/icons-material/Edit'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { VAT_COUNTRY_CODES, getVatIdExample, isValidVatId } from '../../utils/vatRates.ts'
import {
  getRegistrationLabel, getRegistrationExample, getRegistrationOfficeLabel, getRegistrationOfficeExample,
  registrationSameAsVat, registrationUsesOffice, isValidRegistrationNumber,
  LEGAL_FORMS, requiresCompanyDisclosure,
} from '../../utils/businessRegistry.ts'
import type { LegalForm } from '../../utils/businessRegistry.ts'

// Localized country names from the 2-letter code (e.g. 'nl' → 'Netherlands'),
// so the VAT-country dropdown reads naturally without hand-maintained i18n keys.
function vatCountryLabel(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase())
    return name ? `${name} (${code.toUpperCase()})` : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

interface FinancialsEditFormProps {
  form: ProfileForm
  onChange: (field: keyof ProfileForm, value: unknown) => void
  onFormChange: Dispatch<SetStateAction<ProfileForm>>
  schedule: (patch: Partial<ProfileForm>) => void
}

export function FinancialsEditForm({ form, onChange, onFormChange, schedule }: Readonly<FinancialsEditFormProps>) {
  const { t, i18n } = useTranslation('profile')
  const [taxIdConflict, setTaxIdConflict] = useState(false)
  const [kvkConflict, setKvkConflict] = useState(false)

  const registrationLabel = getRegistrationLabel(form.vat_country)
  const usesOffice = registrationUsesOffice(form.vat_country)
  const sameAsVat = registrationSameAsVat(form.vat_country)

  // Switching VAT country must not orphan an incompatible tax_id or registration
  // number (the backend rejects that). Block the change and flag the offending
  // field(s) until each is updated or cleared for the newly chosen country.
  function handleVatCountryChange(code: string) {
    const taxBad = Boolean(form.tax_id) && !isValidVatId(code, form.tax_id)
    const kvkBad = Boolean(form.kvk_number) && !isValidRegistrationNumber(code, form.kvk_number)
    if (taxBad || kvkBad) {
      setTaxIdConflict(taxBad)
      setKvkConflict(kvkBad)
      return
    }
    setTaxIdConflict(false)
    setKvkConflict(false)
    onChange('vat_country', code)
  }

  function handleTaxIdChange(value: string) {
    setTaxIdConflict(false)
    onChange('tax_id', value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14))
  }

  function handleRegistrationChange(value: string) {
    setKvkConflict(false)
    // Registration numbers keep letters/case (e.g. Austria's check letter), so
    // only cap the length; the backend validates the per-country format.
    onChange('kvk_number', value.slice(0, 20))
  }

  function handleTaxPercentageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    onFormChange((prev) => ({ ...prev, tax_percentage: raw as unknown as number }))
    if (raw === '') return
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      schedule({ tax_percentage: n })
    }
  }

  function handleTaxPercentageBlur() {
    if (form.tax_percentage === ('' as unknown as number) || form.tax_percentage == null) {
      onFormChange((prev) => ({ ...prev, tax_percentage: 9 }))
      schedule({ tax_percentage: 9 })
    }
  }

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label={t($ => $.financials.formalName)}
          fullWidth
          value={form.formal_name}
          onChange={(e) => onChange('formal_name', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
          placeholder={t($ => $.financials.formalNamePlaceholder)}
        />
      </Grid>
      {sameAsVat ? (
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            label={t($ => $.financials.registrationNumber)}
            fullWidth
            disabled
            value=""
            helperText={t($ => $.financials.registrationSameAsVat)}
          />
        </Grid>
      ) : (
        <Grid size={{ xs: 12, md: usesOffice ? 4 : 6 }}>
          <TextField
            label={registrationLabel ?? t($ => $.financials.registrationNumber)}
            fullWidth
            value={form.kvk_number}
            onChange={(e) => handleRegistrationChange(e.target.value)}
            error={kvkConflict}
            slotProps={{ htmlInput: { maxLength: 20 } }}
            placeholder={getRegistrationExample(form.vat_country)}
            helperText={kvkConflict
              ? t($ => $.financials.vatCountryIdentifierConflict)
              : t($ => $.financials.registrationHelper, { example: getRegistrationExample(form.vat_country) })}
          />
        </Grid>
      )}
      {!sameAsVat && usesOffice && (
        <Grid size={{ xs: 12, md: 2 }}>
          <TextField
            label={getRegistrationOfficeLabel(form.vat_country) ?? ''}
            fullWidth
            value={form.registration_office}
            onChange={(e) => onChange('registration_office', e.target.value.slice(0, 120))}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            placeholder={getRegistrationOfficeExample(form.vat_country)}
          />
        </Grid>
      )}
      <Grid size={{ xs: 12, md: requiresCompanyDisclosure(form.legal_form) ? 6 : 12 }}>
        <TextField
          select
          label={t($ => $.financials.legalForm)}
          fullWidth
          value={form.legal_form}
          onChange={(e) => onChange('legal_form', e.target.value)}
          helperText={t($ => $.financials.legalFormHelper)}
        >
          <MenuItem value=""><em>{t($ => $.financials.legalFormUnset)}</em></MenuItem>
          {LEGAL_FORMS.map((lf) => (
            <MenuItem key={lf} value={lf}>{t($ => $.financials.legalForms[lf])}</MenuItem>
          ))}
        </TextField>
      </Grid>
      {requiresCompanyDisclosure(form.legal_form) && (
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            label={t($ => $.financials.directors)}
            fullWidth
            value={form.directors}
            onChange={(e) => onChange('directors', e.target.value.slice(0, 300))}
            slotProps={{ htmlInput: { maxLength: 300 } }}
            helperText={t($ => $.financials.directorsHelper)}
          />
        </Grid>
      )}
      <Grid size={{ xs: 12, md: 8 }}>
        <TextField
          label={t($ => $.financials.street)}
          fullWidth
          value={form.address_street}
          onChange={(e) => onChange('address_street', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <TextField
          label={t($ => $.financials.postalCode)}
          fullWidth
          value={form.address_postal_code}
          onChange={(e) => onChange('address_postal_code', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 10 } }}
          placeholder="1234 AB"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label={t($ => $.financials.city)}
          fullWidth
          value={form.address_city}
          onChange={(e) => onChange('address_city', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label={t($ => $.financials.country)}
          fullWidth
          value={form.address_country}
          onChange={(e) => onChange('address_country', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label={t($ => $.financials.iban)}
          fullWidth
          value={form.iban}
          onChange={(e) => onChange('iban', e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 34))}
          slotProps={{ htmlInput: { maxLength: 34, style: { textTransform: 'uppercase' } } }}
          helperText={t($ => $.financials.ibanHelper)}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          select
          label={t($ => $.financials.vatCountry)}
          fullWidth
          value={form.vat_country}
          onChange={(e) => handleVatCountryChange(e.target.value)}
          helperText={t($ => $.financials.vatCountryHelper)}
        >
          {VAT_COUNTRY_CODES.map((code) => (
            <MenuItem key={code} value={code}>{vatCountryLabel(code, i18n.language)}</MenuItem>
          ))}
        </TextField>
      </Grid>
      <Grid size={{ xs: 8, md: 4 }}>
        <TextField
          label={t($ => $.financials.taxId)}
          fullWidth
          value={form.tax_id}
          onChange={(e) => handleTaxIdChange(e.target.value)}
          error={taxIdConflict}
          slotProps={{ htmlInput: { maxLength: 14, style: { textTransform: 'uppercase' } } }}
          placeholder={getVatIdExample(form.vat_country)}
          helperText={taxIdConflict
            ? t($ => $.financials.vatCountryIdentifierConflict)
            : t($ => $.financials.taxIdHelper, { example: getVatIdExample(form.vat_country) })}
        />
      </Grid>
      <Grid size={{ xs: 4, md: 2 }}>
        <TextField
          label={t($ => $.financials.taxPercent)}
          fullWidth
          type="number"
          value={form.tax_percentage}
          onChange={handleTaxPercentageChange}
          onBlur={handleTaxPercentageBlur}
          slotProps={{
            htmlInput: { min: 0, max: 100, step: 0.1 },
            input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
          }}
          helperText={t($ => $.financials.taxPercentHelper)}
        />
      </Grid>
      <Grid size={12}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <FormControlLabel
            control={(
              <Switch
                checked={!!form.applies_kor}
                onChange={(e) => onChange('applies_kor', e.target.checked)}
              />
            )}
            label="KOR"
          />
          <Tooltip title="kleineondernemingsregeling">
            <InfoOutlinedIcon fontSize="small" color="action" />
          </Tooltip>
        </Stack>
      </Grid>
    </Grid>
  )
}

interface FinancialsViewProps {
  form: ProfileForm
}

function FinancialsView({ form }: Readonly<FinancialsViewProps>) {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const taxPercentageDisplay = form.tax_percentage != null && form.tax_percentage !== ('' as unknown as number)
    ? `${form.tax_percentage}%`
    : '—'
  const addressDisplay = [
    form.address_street,
    [form.address_postal_code, form.address_city].filter(Boolean).join(' '),
    form.address_country,
  ].filter(Boolean).join('\n') || '—'

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="caption" color="text.secondary">{t($ => $.financials.formalName)}</Typography>
        <Typography>{form.formal_name || '—'}</Typography>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="caption" color="text.secondary">
          {getRegistrationLabel(form.vat_country) ?? t($ => $.financials.registrationNumber)}
        </Typography>
        <Typography>
          {registrationSameAsVat(form.vat_country)
            ? t($ => $.financials.registrationSameAsVat)
            : [form.kvk_number, form.registration_office].filter(Boolean).join(' · ') || '—'}
        </Typography>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="caption" color="text.secondary">{t($ => $.financials.legalForm)}</Typography>
        <Typography>
          {form.legal_form ? t($ => $.financials.legalForms[form.legal_form as LegalForm]) : '—'}
          {requiresCompanyDisclosure(form.legal_form) && form.directors ? ` · ${form.directors}` : ''}
        </Typography>
      </Grid>
      <Grid size={12}>
        <Typography variant="caption" color="text.secondary">{t($ => $.financials.address)}</Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{addressDisplay}</Typography>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="caption" color="text.secondary">{t($ => $.financials.iban)}</Typography>
        <Typography sx={{ wordBreak: 'break-all' }}>{form.iban || '—'}</Typography>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="caption" color="text.secondary">{t($ => $.financials.vatCountry)}</Typography>
        <Typography>{vatCountryLabel(form.vat_country || 'nl', i18n.language)}</Typography>
      </Grid>
      <Grid size={{ xs: 8, md: 4 }}>
        <Typography variant="caption" color="text.secondary">{t($ => $.financials.taxId)}</Typography>
        <Typography>{form.tax_id || '—'}</Typography>
      </Grid>
      <Grid size={{ xs: 4, md: 2 }}>
        <Typography variant="caption" color="text.secondary">{t($ => $.financials.taxPercent)}</Typography>
        <Typography>{taxPercentageDisplay}</Typography>
      </Grid>
      <Grid size={12}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>KOR</Typography>
          <Typography>{form.applies_kor ? t($ => $.answer.yes, { ns: 'common' }) : t($ => $.answer.no, { ns: 'common' })}</Typography>
          <Tooltip title="kleineondernemingsregeling">
            <InfoOutlinedIcon fontSize="small" color="action" />
          </Tooltip>
        </Stack>
      </Grid>
    </Grid>
  )
}

interface ProfileFinancialsTabProps {
  form: ProfileForm
  isAdmin?: boolean
  editing?: boolean
  onToggleEditing: () => void
  onChange: (field: keyof ProfileForm, value: unknown) => void
  onFormChange: Dispatch<SetStateAction<ProfileForm>>
  schedule: (patch: Partial<ProfileForm>) => void
}

export default function ProfileFinancialsTab({ form, isAdmin, editing, onToggleEditing, onChange, onFormChange, schedule }: Readonly<ProfileFinancialsTabProps>) {
  const { t } = useTranslation(['profile', 'common'])
  const editable = editing && isAdmin
  return (
    <Box sx={{ p: 3 }}>


      {editable
        ? <FinancialsEditForm form={form} onChange={onChange} onFormChange={onFormChange} schedule={schedule} />
        : <FinancialsView form={form} />}

      {isAdmin && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            size="small"
            startIcon={editing ? <CheckIcon /> : <EditIcon />}
            onClick={onToggleEditing}
            variant={editing ? 'contained' : 'outlined'}
            aria-label={editing ? t($ => $.financials.doneAria) : t($ => $.financials.editAria)}
          >
            {editing ? t($ => $.actions.done, { ns: 'common' }) : t($ => $.actions.edit, { ns: 'common' })}
          </Button>
        </Box>
      )}
    </Box>
  )
}
