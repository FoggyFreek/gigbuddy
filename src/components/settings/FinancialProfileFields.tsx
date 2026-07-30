import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { getProfile, updateProfile } from '../../api/profile.ts'
import { updateAccountingProfile } from '../../api/accountingProfile.ts'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { useAccountingProfile } from '../../contexts/accountingProfileContext.ts'
import { getVatIdExample } from '../../utils/vatRates.ts'
import {
  getRegistrationLabel, getRegistrationExample, getRegistrationOfficeLabel, getRegistrationOfficeExample,
  registrationSameAsVat, registrationUsesOffice, requiresCompanyDisclosure,
} from '../../utils/businessRegistry.ts'
import { getLocalLegalForms } from '../../utils/accountingProfileCodes.ts'

// The identity fields this section owns, all on the tenant row and all printed on
// invoices (EN 16931 BT-27..BT-43). The accounting REGIME — country, currency,
// financial year, VAT registration and filing — is the accounting-profile section's
// business, and the two must not both edit the same field.
const IDENTITY_FIELDS = [
  'formal_name', 'address_street', 'address_postal_code', 'address_city', 'address_country',
  'kvk_number', 'registration_office', 'directors', 'email', 'phone', 'iban', 'tax_id',
] as const

type IdentityField = typeof IDENTITY_FIELDS[number]
type IdentityForm = Record<IdentityField, string>

const EMPTY: IdentityForm = {
  formal_name: '', address_street: '', address_postal_code: '', address_city: '',
  address_country: '', kvk_number: '', registration_office: '', directors: '',
  email: '', phone: '', iban: '', tax_id: '',
}

const KNOWN_ERROR_CODES = [
  'invalid_email', 'invalid_phone', 'invalid_iban', 'invalid_tax_id', 'invalid_kvk_number',
] as const

type KnownErrorCode = typeof KNOWN_ERROR_CODES[number]

function isKnownErrorCode(code: string): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code)
}

// The band's legal and financial identity: the name, address and identifiers that
// appear on its invoices. Text fields debounce; the legal-form select saves at once.
//
// Rendered inside FinancialProfileSection and standalone in the finance-onboarding
// wizard's financial-profile step.
export default function FinancialProfileFields() {
  const { t } = useTranslation(['profile', 'settings'])
  const { profile: accounting, applyProfile } = useAccountingProfile()
  const [form, setForm] = useState<IdentityForm>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const country = accounting?.country_code ?? null
  const legalForm = accounting?.legal_form ?? null

  const reportError = useCallback((err: unknown) => {
    const e = err as { code?: string; message?: string }
    const code = e.code ?? e.message ?? ''
    setError(isKnownErrorCode(code)
      ? t($ => $.financialProfile.errors[code], { ns: 'settings' })
      : e.message ?? t($ => $.financialProfile.errors.unknown, { ns: 'settings' }))
  }, [t])

  // useDebouncedSave swallows a rejection into its own status, so a save that the
  // server refuses (a malformed IBAN, a VAT number that does not fit the country)
  // would disappear silently. Report it here instead.
  const persist = useCallback(async (patch: Partial<IdentityForm>) => {
    try {
      await updateProfile(patch)
    } catch (err) {
      reportError(err)
    }
  }, [reportError])
  const { schedule } = useDebouncedSave<Partial<IdentityForm>>(persist)

  // The free-text note beside the legal form. It lives on the accounting profile
  // (alongside the code it annotates) but is asked here, with the form it describes.
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const legalFormNote = noteDraft ?? accounting?.local_legal_form_label ?? ''
  const persistNote = useCallback(async (patch: { local_legal_form_label: string | null }) => {
    try {
      applyProfile(await updateAccountingProfile(patch))
    } catch (err) {
      reportError(err)
    }
  }, [applyProfile, reportError])
  const { schedule: scheduleNote } = useDebouncedSave(persistNote)

  useEffect(() => {
    let cancelled = false
    getProfile()
      .then((p) => {
        if (cancelled) return
        const loaded = { ...EMPTY }
        for (const field of IDENTITY_FIELDS) {
          loaded[field] = String((p as Record<string, unknown>)[field] ?? '')
        }
        setForm(loaded)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function change(field: IdentityField, value: string) {
    setError(null)
    setForm((prev) => ({ ...prev, [field]: value }))
    schedule({ [field]: value })
  }

  // The legal form lives on the accounting profile (it derives the reporting
  // framework), but it is asked here because it is an identity fact and it decides
  // whether the company-law director disclosure appears on invoices.
  async function changeLegalForm(code: string) {
    setError(null)
    try {
      applyProfile(await updateAccountingProfile({ local_legal_form_code: code || null }))
    } catch (err) {
      reportError(err)
    }
  }

  if (loading) return <CircularProgress size={20} />

  const sameAsVat = registrationSameAsVat(country)
  const usesOffice = registrationUsesOffice(country)
  const localLegalForms = getLocalLegalForms(country)

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            id="financial-profile-formal-name"
            label={t($ => $.financials.formalName)}
            fullWidth
            size="small"
            value={form.formal_name}
            onChange={(e) => change('formal_name', e.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            placeholder={t($ => $.financials.formalNamePlaceholder)}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            select
            id="financial-profile-legal-form"
            label={t($ => $.financials.legalForm)}
            fullWidth
            size="small"
            value={accounting?.local_legal_form_code ?? ''}
            onChange={(e) => void changeLegalForm(e.target.value)}
            helperText={t($ => $.financials.legalFormHelper)}
          >
            <MenuItem value=""><em>{t($ => $.financials.legalFormUnset)}</em></MenuItem>
            {localLegalForms.map((lf) => (
              <MenuItem key={lf.code} value={lf.code}>{lf.label}</MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            id="financial-profile-legal-form-note"
            label={t($ => $.financialProfile.legalFormNote, { ns: 'settings' })}
            fullWidth
            size="small"
            value={legalFormNote}
            onChange={(e) => {
              const next = e.target.value.slice(0, 120)
              setNoteDraft(next)
              scheduleNote({ local_legal_form_label: next || null })
            }}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            helperText={t($ => $.financialProfile.legalFormNoteHelper, { ns: 'settings' })}
          />
        </Grid>

        {sameAsVat ? (
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              label={t($ => $.financials.registrationNumber)}
              fullWidth
              size="small"
              disabled
              value=""
              helperText={t($ => $.financials.registrationSameAsVat)}
            />
          </Grid>
        ) : (
          <Grid size={{ xs: 12, md: usesOffice ? 4 : 6 }}>
            <TextField
              id="financial-profile-registration-number"
              label={getRegistrationLabel(country) ?? t($ => $.financials.registrationNumber)}
              fullWidth
              size="small"
              value={form.kvk_number}
              // Registration numbers keep letters and case (Austria's check letter),
              // so only the length is capped here; the format is validated server-side.
              onChange={(e) => change('kvk_number', e.target.value.slice(0, 20))}
              slotProps={{ htmlInput: { maxLength: 20 } }}
              placeholder={getRegistrationExample(country)}
              helperText={t($ => $.financials.registrationHelper, { example: getRegistrationExample(country) })}
            />
          </Grid>
        )}

        {!sameAsVat && usesOffice && (
          <Grid size={{ xs: 12, md: 2 }}>
            <TextField
              id="financial-profile-registration-office"
              label={getRegistrationOfficeLabel(country) ?? ''}
              fullWidth
              size="small"
              value={form.registration_office}
              onChange={(e) => change('registration_office', e.target.value.slice(0, 120))}
              slotProps={{ htmlInput: { maxLength: 120 } }}
              placeholder={getRegistrationOfficeExample(country)}
            />
          </Grid>
        )}

        {requiresCompanyDisclosure(legalForm) && (
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              id="financial-profile-directors"
              label={t($ => $.financials.directors)}
              fullWidth
              size="small"
              value={form.directors}
              onChange={(e) => change('directors', e.target.value.slice(0, 300))}
              slotProps={{ htmlInput: { maxLength: 300 } }}
              helperText={t($ => $.financials.directorsHelper)}
            />
          </Grid>
        )}

        <Grid size={{ xs: 12, md: 8 }}>
          <TextField
            id="financial-profile-street"
            label={t($ => $.financials.street)}
            fullWidth
            size="small"
            value={form.address_street}
            onChange={(e) => change('address_street', e.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <TextField
            id="financial-profile-postal-code"
            label={t($ => $.financials.postalCode)}
            fullWidth
            size="small"
            value={form.address_postal_code}
            onChange={(e) => change('address_postal_code', e.target.value)}
            slotProps={{ htmlInput: { maxLength: 10 } }}
            placeholder="1234 AB"
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            id="financial-profile-city"
            label={t($ => $.financials.city)}
            fullWidth
            size="small"
            value={form.address_city}
            onChange={(e) => change('address_city', e.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            id="financial-profile-country"
            label={t($ => $.financials.country)}
            fullWidth
            size="small"
            value={form.address_country}
            onChange={(e) => change('address_country', e.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            helperText={t($ => $.financialProfile.postalCountryHelper, { ns: 'settings' })}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            id="financial-profile-email"
            label={t($ => $.financials.email)}
            type="email"
            fullWidth
            size="small"
            value={form.email}
            onChange={(e) => change('email', e.target.value)}
            slotProps={{ htmlInput: { maxLength: 254 } }}
            helperText={t($ => $.financials.contactHelper)}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            id="financial-profile-phone"
            label={t($ => $.financials.phone)}
            type="tel"
            fullWidth
            size="small"
            value={form.phone}
            onChange={(e) => change('phone', e.target.value)}
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            id="financial-profile-iban"
            label={t($ => $.financials.iban)}
            fullWidth
            size="small"
            value={form.iban}
            onChange={(e) => change('iban', e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 34))}
            slotProps={{ htmlInput: { maxLength: 34, style: { textTransform: 'uppercase' } } }}
            helperText={t($ => $.financials.ibanHelper)}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            id="financial-profile-tax-id"
            label={t($ => $.financials.taxId)}
            fullWidth
            size="small"
            value={form.tax_id}
            onChange={(e) => change('tax_id', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14))}
            slotProps={{ htmlInput: { maxLength: 14, style: { textTransform: 'uppercase' } } }}
            placeholder={getVatIdExample(country)}
            helperText={t($ => $.financials.taxIdHelper, { example: getVatIdExample(country) })}
          />
        </Grid>
      </Grid>
    </>
  )
}
