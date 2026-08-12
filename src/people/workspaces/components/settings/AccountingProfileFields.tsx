import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import {
  updateAccountingProfile,
  confirmAccountingProfile,
  changeAccountingCountry,
  type AccountingProfilePatch,
} from '../../../../finance/accounting-profile/accountingProfile.ts'
import { useAccountingProfile } from '../../../../contexts/accountingProfileContext.ts'
import type { AccountingProfile } from '../../../../types/entities.ts'
import { VAT_COUNTRY_CODES } from '../../../../finance/vat/vatRates.ts'
import { useAuth } from '../../../../contexts/authContext.ts'
import VatRateSelect from '../../../../components/shared/VatRateSelect.tsx'

// 'exempt' is deliberately absent: it is DERIVED from a VAT scheme enrolment,
// which carries dates, a jurisdiction and a confirmation this select cannot
// express. The scheme editor below owns it, and the server rejects a direct
// write in either direction so the two can never disagree.
const VAT_FREQUENCIES = ['monthly', 'quarterly', 'yearly', 'authority_assigned'] as const
const VAT_REGISTERED_OPTIONS = ['yes', 'no', 'unconfirmed'] as const

// The error codes the backend can return for a profile write. Anything else falls
// back to the generic message rather than rendering a raw server string.
const KNOWN_ERROR_CODES = [
  'country_immutable',
  'profile_incomplete',
  'vat_fields_require_registration',
  'vat_fields_required_when_registered',
  'invalid_financial_year_start',
  'invalid_financial_year_start_month',
  'invalid_financial_year_start_day',
  'accounting_country_has_financial_documents',
  'tax_id_incompatible_vat_country',
  'kvk_incompatible_vat_country',
] as const

type KnownErrorCode = typeof KNOWN_ERROR_CODES[number]

function isKnownErrorCode(code: string): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code)
}

// Localized country name from the 2-letter code, so the read-only country field
// reads naturally without hand-maintained i18n keys.
function countryLabel(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase())
    return name ? `${name} (${code.toUpperCase()})` : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

function vatRegisteredValue(registered: boolean | null): typeof VAT_REGISTERED_OPTIONS[number] {
  if (registered === true) return 'yes'
  if (registered === false) return 'no'
  return 'unconfirmed'
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

// Days selectable for a month. February caps at 28 and the 30-day months at 30,
// mirroring the server rule that a financial year must start on a date that
// exists in every year.
function daysForMonth(month: number): number[] {
  let max = 31
  if (month === 2) max = 28
  else if ([4, 6, 9, 11].includes(month)) max = 30
  return Array.from({ length: max }, (_, i) => i + 1)
}

// The accounting profile form: the REGIME only — the financial-year start, whether
// the band is VAT registered (plus the filing period the tax authority assigned it)
// and the invoice VAT defaults. The band's identity, including its legal form, is
// the financial-profile section's business; no field appears in both.
//
// Country and base currency are shown
// read-only because they are fixed at band creation. The entity size, accounting
// basis, VAT basis and reporting framework are not shown at all — they are derived
// or product facts, recorded on the row for reports and accountant exports rather
// than put to a user who could not answer them.
//
// Rendered inside AccountingProfileSection; kept separate from that chrome so the
// finance-onboarding wizard can reuse the fields on their own.
export default function AccountingProfileFields() {
  const { t, i18n } = useTranslation('settings')
  const { profile, loading, applyProfile } = useAccountingProfile()
  const { refreshUser } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countryDialogOpen, setCountryDialogOpen] = useState(false)
  const [nextCountry, setNextCountry] = useState('')

  async function save(patch: AccountingProfilePatch) {
    setSaving(true)
    setError(null)
    try {
      applyProfile(await updateAccountingProfile(patch))
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const code = e.code ?? e.message ?? ''
      setError(isKnownErrorCode(code)
        ? t($ => $.accountingProfile.errors[code])
        : e.message ?? t($ => $.accountingProfile.errors.unknown))
    } finally {
      setSaving(false)
    }
  }

  async function confirm() {
    setSaving(true)
    setError(null)
    try {
      applyProfile(await confirmAccountingProfile())
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const code = e.code ?? e.message ?? ''
      setError(isKnownErrorCode(code)
        ? t($ => $.accountingProfile.errors[code])
        : e.message ?? t($ => $.accountingProfile.errors.unknown))
    } finally {
      setSaving(false)
    }
  }

  async function changeCountry() {
    if (!nextCountry) return
    setSaving(true)
    setError(null)
    try {
      const next = await changeAccountingCountry({ country_code: nextCountry })
      applyProfile(next)
      await refreshUser()
      setCountryDialogOpen(false)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const code = e.code ?? e.message ?? ''
      setError(isKnownErrorCode(code)
        ? t($ => $.accountingProfile.errors[code])
        : e.message ?? t($ => $.accountingProfile.errors.unknown))
      setCountryDialogOpen(false)
    } finally {
      setSaving(false)
    }
  }

  function handleVatRegistered(value: string) {
    if (value === 'yes') return void save({ vat_registered: true })
    if (value === 'no') return void save({ vat_registered: false })
    return void save({ vat_registered: null })
  }

  if (loading) return <CircularProgress size={20} />
  if (!profile) {
    return <Alert severity="error">{t($ => $.accountingProfile.errors.unavailable)}</Alert>
  }

  const registered = profile.vat_registered === true
  const vatFieldsDisabled = saving || !registered
  // A scheme is in force: the filing period is 'exempt' and owned by the scheme
  // editor, not by this select.
  const schemeExempt = profile.vat_filing_frequency === 'exempt'

  function schemeExemptHelper(): string {
    if (schemeExempt) return t($ => $.accountingProfile.vatScheme.frequencyFromScheme)
    return registered
      ? t($ => $.accountingProfile.vatFilingFrequencyHelper)
      : t($ => $.accountingProfile.notApplicable)
  }

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      {profile.presentation_state === 'needs_review' && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={(
            <Button color="inherit" size="small" onClick={confirm} disabled={saving}>
              {t($ => $.accountingProfile.confirmCta)}
            </Button>
          )}
        >
          {t($ => $.accountingProfile.needsReview)}
        </Alert>
      )}

      <Stack spacing={2}>
        {/* Country is fixed at band creation: changing it would also have to reset
            and revalidate the VAT id, registration, rates, currency and drafts. */}
        <TextField
          id="accounting-profile-country"
          label={t($ => $.accountingProfile.country)}
          fullWidth
          size="small"
          disabled
          value={countryLabel(profile.country_code, i18n.language)}
          helperText={t($ => $.accountingProfile.countryHelper)}
        />
        <Button
          variant="outlined"
          disabled={saving}
          onClick={() => {
            setNextCountry(profile.country_code)
            setCountryDialogOpen(true)
          }}
        >
          {t($ => $.accountingProfile.changeCountry.action)}
        </Button>

        <TextField
          id="accounting-profile-base-currency"
          label={t($ => $.accountingProfile.baseCurrency)}
          fullWidth
          size="small"
          disabled
          value={profile.base_currency}
          helperText={t($ => $.accountingProfile.baseCurrencyHelper)}
        />

        <Stack direction="row" spacing={2}>
          <TextField
            select
            id="accounting-profile-fy-month"
            label={t($ => $.accountingProfile.financialYearStartMonth)}
            fullWidth
            size="small"
            disabled={saving}
            value={profile.financial_year_start_month}
            onChange={(e) => void save({ financial_year_start_month: Number(e.target.value) })}
          >
            {MONTHS.map((month) => (
              <MenuItem key={month} value={month}>
                {new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(2000, month - 1, 1))}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            id="accounting-profile-fy-day"
            label={t($ => $.accountingProfile.financialYearStartDay)}
            fullWidth
            size="small"
            disabled={saving}
            value={profile.financial_year_start_day}
            onChange={(e) => void save({ financial_year_start_day: Number(e.target.value) })}
          >
            {daysForMonth(profile.financial_year_start_month).map((day) => (
              <MenuItem key={day} value={day}>{day}</MenuItem>
            ))}
          </TextField>
        </Stack>

        <TextField
          select
          id="accounting-profile-vat-registered"
          label={t($ => $.accountingProfile.vatRegistered)}
          fullWidth
          size="small"
          disabled={saving}
          value={vatRegisteredValue(profile.vat_registered)}
          onChange={(e) => handleVatRegistered(e.target.value)}
          helperText={t($ => $.accountingProfile.vatRegisteredHelper)}
        >
          {VAT_REGISTERED_OPTIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {t($ => $.accountingProfile.vatRegisteredOptions[option])}
            </MenuItem>
          ))}
        </TextField>

        {/* The filing period only exists for a registered band. A band that is
            not registered has it stored as "not applicable" by the server, so
            this renders disabled rather than demanding a meaningless choice.
            While a VAT scheme is in force the period is exempt and DERIVED, so
            the select is replaced by a read-only statement pointing at the
            control that owns it — offering a choice the server would reject
            would be worse than not offering one. */}
        <TextField
          select
          id="accounting-profile-vat-frequency"
          label={t($ => $.accountingProfile.vatFilingFrequency)}
          fullWidth
          size="small"
          disabled={vatFieldsDisabled || schemeExempt}
          value={!schemeExempt
            && registered
            && VAT_FREQUENCIES.includes(profile.vat_filing_frequency as typeof VAT_FREQUENCIES[number])
            ? profile.vat_filing_frequency
            : ''}
          onChange={(e) => void save({
            vat_filing_frequency: e.target.value as AccountingProfile['vat_filing_frequency'],
          })}
          helperText={schemeExemptHelper()}
        >
          <MenuItem value=""><em>{t($ => $.accountingProfile.unset)}</em></MenuItem>
          {VAT_FREQUENCIES.map((freq) => (
            <MenuItem key={freq} value={freq}>
              {t($ => $.accountingProfile.vatFilingFrequencies[freq])}
            </MenuItem>
          ))}
        </TextField>

        <VatRateSelect
          id="accounting-profile-default-vat-rate"
          label={t($ => $.accountingProfile.defaultVatRate)}
          country={profile.country_code}
          value={profile.default_vat_rate}
          onChange={(rate) => rate != null && void save({ default_vat_rate: rate })}
          disabled={saving}
          helperText={t($ => $.accountingProfile.defaultVatRateHelper)}
        />

      </Stack>
      <Dialog open={countryDialogOpen} onClose={() => setCountryDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t($ => $.accountingProfile.changeCountry.title)}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t($ => $.accountingProfile.changeCountry.warning)}
          </Alert>
          <TextField
            select
            fullWidth
            size="small"
            label={t($ => $.accountingProfile.country)}
            value={nextCountry}
            onChange={(event) => setNextCountry(event.target.value)}
          >
            {VAT_COUNTRY_CODES.map((code) => (
              <MenuItem key={code} value={code}>{countryLabel(code, i18n.language)}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCountryDialogOpen(false)}>
            {t($ => $.accountingProfile.changeCountry.cancel)}
          </Button>
          <Button
            color="warning"
            variant="contained"
            disabled={saving || !nextCountry || nextCountry === profile.country_code}
            onClick={() => void changeCountry()}
          >
            {t($ => $.accountingProfile.changeCountry.confirm)}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
